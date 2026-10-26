package studio.diagram;

import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.nio.file.*;
import java.util.*;
import org.h2.jdbcx.JdbcDataSource;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.json.JsonMapper;
import static org.junit.jupiter.api.Assertions.*;

class ExportJobsTest {
    @TempDir Path directory;
    JdbcTemplate db;
    ExportJobs jobs;
    HttpServer worker;
    final String key = "TEST_ONLY_WORKER_KEY_00000000000000";
    @BeforeEach void prepare() throws Exception {
        var source = new JdbcDataSource(); source.setURL("jdbc:h2:mem:" + UUID.randomUUID() + ";MODE=MySQL;DB_CLOSE_DELAY=-1");
        db = new JdbcTemplate(source);
        db.execute("CREATE TABLE export_jobs(id VARCHAR(36) PRIMARY KEY,owner_hash VARCHAR(64),request_id VARCHAR(36),state VARCHAR(16),snapshot MEDIUMTEXT,created_at BIGINT,expires_at BIGINT,error_message VARCHAR(200),UNIQUE(owner_hash,request_id))");
        worker = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        worker.createContext("/render", exchange -> {
            assertEquals(key, exchange.getRequestHeaders().getFirst("X-Worker-Key"));
            exchange.getRequestBody().readAllBytes();
            byte[] pdf = "%PDF-1.7\nTEST FIXTURE".getBytes(); exchange.sendResponseHeaders(200, pdf.length); exchange.getResponseBody().write(pdf); exchange.close();
        });
        worker.start();
        jobs = new ExportJobs(db, JsonMapper.builder().build(), directory.toString(), "http://127.0.0.1:" + worker.getAddress().getPort(), key, 600, true);
    }
    @AfterEach void stop() { worker.stop(0); }
    Map<String, Object> request() {
        return new HashMap<>(Map.of("requestId", UUID.randomUUID().toString(), "document", Map.of("schemaVersion", 1, "entities", List.of()), "paper", "A4", "orientation", "landscape", "paginate", false, "padding", 40));
    }
    @Test void isolatesOwnersAndDeduplicatesRetries() {
        var request = request(); var first = jobs.create("owner-a", request);
        assertEquals(first.id(), jobs.create("owner-a", request).id());
        assertNotEquals(first.id(), jobs.create("owner-b", request).id());
        assertEquals(404, assertThrows(ResponseStatusException.class, () -> jobs.owned("owner-b", first.id())).getStatusCode().value());
        assertEquals(409, assertThrows(ResponseStatusException.class, () -> jobs.result(first)).getStatusCode().value());
    }
    @Test void processesImmutableSnapshotAndClearsInputOnSuccess() throws Exception {
        var request = request(); var job = jobs.create("a", request); request.put("paper", "A3");
        assertTrue(jobs.owned("a", job.id()).snapshot().contains("A4"));
        jobs.process(); var result = jobs.owned("a", job.id());
        assertEquals("SUCCEEDED", result.state()); assertEquals("", result.snapshot());
        assertTrue(Files.readString(jobs.result(result)).startsWith("%PDF-"));
        Files.delete(jobs.result(result));
        assertEquals(410, assertThrows(ResponseStatusException.class, () -> jobs.result(result)).getStatusCode().value());
        assertEquals("FAILED", jobs.owned("a", job.id()).state());
    }
    @Test void rejectsInvalidParametersAndLimitsAbuse() {
        var request = request(); request.put("paper", "A2"); assertThrows(ResponseStatusException.class, () -> jobs.create("a", request));
        for (int n = 0; n < 20; n++) jobs.create("a", request());
        assertEquals(429, assertThrows(ResponseStatusException.class, () -> jobs.create("a", request())).getStatusCode().value());
    }
    @Test void restartMarksInterruptedJobFailedButKeepsQueuedWork() throws Exception {
        var interrupted = jobs.create("a", request()); var queued = jobs.create("a", request());
        db.update("UPDATE export_jobs SET state='RUNNING' WHERE id=?", interrupted.id());
        Path orphan = directory.resolve(UUID.randomUUID() + ".pdf"); Files.writeString(orphan, "orphan");
        jobs.recover();
        assertEquals("FAILED", jobs.owned("a", interrupted.id()).state()); assertEquals("QUEUED", jobs.owned("a", queued.id()).state()); assertFalse(Files.exists(orphan));
    }
    @Test void expirationRemovesResultsAndSnapshotAndMakesTaskInaccessible() throws Exception {
        var job = jobs.create("a", request()); jobs.process(); Path result = jobs.result(jobs.owned("a", job.id()));
        db.update("UPDATE export_jobs SET expires_at=0 WHERE id=?", job.id());
        assertThrows(ResponseStatusException.class, () -> jobs.owned("a", job.id())); jobs.cleanup();
        assertFalse(Files.exists(result)); assertEquals(0, db.queryForObject("SELECT COUNT(*) FROM export_jobs", Integer.class));
    }
    @Test void workerFailureIsTerminalAndDoesNotExposeInternalDetails() {
        var job = jobs.create("a", request()); worker.stop(0); jobs.process();
        var result = jobs.owned("a", job.id()); assertEquals("FAILED", result.state()); assertEquals("", result.snapshot());
        assertFalse(result.error().contains("127.0.0.1"));
    }
    @Test void expiredRetryBeforeCleanupReturnsGoneInsteadOfDuplicateKeyFailure() {
        var request = request(); var job = jobs.create("a", request);
        db.update("UPDATE export_jobs SET expires_at=0 WHERE id=?", job.id());
        assertEquals(410, assertThrows(ResponseStatusException.class, () -> jobs.create("a", request)).getStatusCode().value());
    }
}
