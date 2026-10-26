package studio.diagram;

import java.io.IOException;
import java.net.URI;
import java.net.http.*;
import java.nio.file.*;
import java.time.Duration;
import java.util.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.json.JsonMapper;

@Service
class ExportJobs {
    record Job(String id, String owner, String state, String snapshot, long expires, String error) {}
    private final JdbcTemplate db;
    private final JsonMapper json;
    private final Path directory;
    private final String workerUrl, workerKey;
    private final long retention;
    private final boolean processing;
    private final HttpClient client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build();
    ExportJobs(JdbcTemplate db, JsonMapper json, @Value("${diagram.export-directory}") String directory,
               @Value("${diagram.worker-url}") String workerUrl, @Value("${diagram.worker-key}") String workerKey,
               @Value("${diagram.retention-seconds}") long retention, @Value("${diagram.processing-enabled}") boolean processing) throws IOException {
        this.db = db; this.json = json; this.directory = Path.of(directory).toAbsolutePath().normalize();
        this.workerUrl = workerUrl; this.workerKey = workerKey; this.retention = retention; this.processing = processing;
        if (retention < 1 || retention > 86340 || workerKey.length() < 24) throw new IllegalArgumentException("Invalid task retention or worker configuration");
        Files.createDirectories(this.directory);
    }
    private List<Job> find(String where, Object... parameters) {
        return db.query("SELECT id,owner_hash,state,snapshot,expires_at,error_message FROM export_jobs " + where,
            (r, n) -> new Job(r.getString(1), r.getString(2), r.getString(3), r.getString(4), r.getLong(5), r.getString(6)), parameters);
    }
    synchronized Job create(String owner, Map<String, Object> body) {
        String requestId = Objects.toString(body.get("requestId"), "");
        if (!requestId.matches("[0-9a-fA-F-]{36}")) throw invalid();
        var previous = find("WHERE owner_hash=? AND request_id=?", owner, requestId);
        if (!previous.isEmpty()) {
            if (previous.getFirst().expires <= System.currentTimeMillis()) throw new ResponseStatusException(HttpStatus.GONE, "原任务已过期，请重新生成");
            return previous.getFirst();
        }
        if (!(body.get("document") instanceof Map<?, ?> document) || !Integer.valueOf(1).equals(document.get("schemaVersion"))
            || !(document.get("entities") instanceof List<?> entities) || entities.size() > 200
            || !List.of("A4", "A3").contains(body.get("paper")) || !List.of("landscape", "portrait").contains(body.get("orientation"))
            || !(body.get("paginate") instanceof Boolean) || !(body.get("padding") instanceof Number padding) || padding.doubleValue() < 10 || padding.doubleValue() > 200) throw invalid();
        long total = db.queryForObject("SELECT COUNT(*) FROM export_jobs WHERE expires_at>?", Long.class, System.currentTimeMillis());
        long owned = db.queryForObject("SELECT COUNT(*) FROM export_jobs WHERE owner_hash=? AND expires_at>?", Long.class, owner, System.currentTimeMillis());
        long pending = db.queryForObject("SELECT COUNT(*) FROM export_jobs WHERE state IN ('QUEUED','RUNNING')", Long.class);
        if (total >= 1000 || owned >= 20 || pending >= 50) throw new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS, "导出任务较多，请稍后再试");
        String id = UUID.randomUUID().toString(), snapshot = json.writeValueAsString(body);
        long now = System.currentTimeMillis(), expires = now + retention * 1000;
        db.update("INSERT INTO export_jobs(id,owner_hash,request_id,state,snapshot,created_at,expires_at) VALUES(?,?,?,'QUEUED',?,?,?)", id, owner, requestId, snapshot, now, expires);
        return new Job(id, owner, "QUEUED", snapshot, expires, null);
    }
    static ResponseStatusException invalid() { return new ResponseStatusException(HttpStatus.BAD_REQUEST, "导出参数或项目结构无效"); }
    Job owned(String owner, String id) {
        var jobs = find("WHERE id=? AND owner_hash=? AND expires_at>?", id, owner, System.currentTimeMillis());
        if (jobs.isEmpty()) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "任务不存在或已过期");
        return jobs.getFirst();
    }
    Path result(Job job) {
        if (!job.state.equals("SUCCEEDED")) throw new ResponseStatusException(HttpStatus.CONFLICT, "PDF 尚未生成");
        Path file = file(job.id);
        if (!Files.isRegularFile(file)) {
            db.update("UPDATE export_jobs SET state='FAILED',error_message=? WHERE id=?", "结果文件缺失，请重新生成", job.id);
            throw new ResponseStatusException(HttpStatus.GONE, "结果文件缺失，请重新生成");
        }
        return file;
    }
    private Path file(String id) {
        if (!id.matches("[0-9a-f-]{36}")) throw invalid();
        return directory.resolve(id + ".pdf");
    }
    @EventListener(ApplicationReadyEvent.class) void recover() throws IOException {
        db.update("UPDATE export_jobs SET state='FAILED',error_message=? WHERE state='RUNNING'", "服务重启中断了此任务，请重新生成");
        try (var files = Files.list(directory)) {
            for (Path path : files.toList()) {
                String name = path.getFileName().toString();
                if (name.matches("[0-9a-f-]{36}\\.pdf")) {
                    String id = name.substring(0, 36);
                    if (db.queryForObject("SELECT COUNT(*) FROM export_jobs WHERE id=?", Long.class, id) == 0) Files.deleteIfExists(path);
                }
            }
        }
        cleanup();
    }
    @Scheduled(fixedDelayString="${diagram.cleanup-ms}", initialDelay=1000) synchronized void cleanup() throws IOException {
        var expired = find("WHERE expires_at<=?", System.currentTimeMillis());
        for (Job job : expired) { Files.deleteIfExists(file(job.id)); db.update("DELETE FROM export_jobs WHERE id=?", job.id); }
    }
    @Scheduled(fixedDelay=500, initialDelay=2000) void process() {
        if (!processing) return;
        var queue = find("WHERE state='QUEUED' AND expires_at>? ORDER BY created_at LIMIT 1", System.currentTimeMillis());
        if (queue.isEmpty()) return;
        Job job = queue.getFirst();
        if (db.update("UPDATE export_jobs SET state='RUNNING' WHERE id=? AND state='QUEUED'", job.id) != 1) return;
        try {
            var request = HttpRequest.newBuilder(URI.create(workerUrl + "/render")).timeout(Duration.ofSeconds(120))
                .header("Content-Type", "application/json").header("X-Worker-Key", workerKey).POST(HttpRequest.BodyPublishers.ofString(job.snapshot)).build();
            var response = client.send(request, HttpResponse.BodyHandlers.ofByteArray());
            byte[] bytes = response.body();
            if (response.statusCode() != 200 || bytes.length < 5 || bytes.length > 30_000_000 || !new String(bytes, 0, 5, java.nio.charset.StandardCharsets.US_ASCII).equals("%PDF-")) throw new IOException("Worker failed");
            synchronized (this) {
                if (job.expires <= System.currentTimeMillis()) return;
                Files.write(file(job.id), bytes, StandardOpenOption.CREATE_NEW);
                db.update("UPDATE export_jobs SET state='SUCCEEDED',snapshot='' WHERE id=? AND expires_at>?", job.id, System.currentTimeMillis());
            }
        } catch (Exception e) {
            db.update("UPDATE export_jobs SET state='FAILED',snapshot='',error_message=? WHERE id=?", "PDF 生成失败，请检查图表规模或稍后重试", job.id);
            if (e instanceof InterruptedException) Thread.currentThread().interrupt();
        }
    }
}
