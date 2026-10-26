package studio.diagram;

import jakarta.servlet.http.*;
import java.nio.charset.StandardCharsets;
import java.security.*;
import java.util.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.FileSystemResource;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

@RestController
class ExportController {
    private final ExportJobs jobs;
    private final boolean secureCookie;
    private final SecureRandom random = new SecureRandom();
    ExportController(ExportJobs jobs, @Value("${diagram.secure-cookie}") boolean secureCookie) { this.jobs = jobs; this.secureCookie = secureCookie; }
    private String owner(HttpServletRequest request, HttpServletResponse response) {
        String token = null;
        if (request.getCookies() != null) for (Cookie cookie : request.getCookies()) if (cookie.getName().equals("diagram_session") && cookie.getValue().matches("[A-Za-z0-9_-]{43}")) token = cookie.getValue();
        if (token == null) {
            byte[] bytes = new byte[32]; random.nextBytes(bytes); token = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
        }
        response.addHeader("Set-Cookie", ResponseCookie.from("diagram_session", token).httpOnly(true).secure(secureCookie).sameSite("Lax").path("/api").maxAge(86400).build().toString());
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(token.getBytes(StandardCharsets.UTF_8))); }
        catch (NoSuchAlgorithmException e) { throw new IllegalStateException(e); }
    }
    private Map<String, Object> view(ExportJobs.Job job) {
        return Map.of("id", job.id(), "state", job.state(), "expiresAt", job.expires(), "error", job.error() == null ? "" : job.error());
    }
    @GetMapping("/api/health") Map<String, String> health() { return Map.of("status", "UP"); }
    @PostMapping("/api/v1/export-jobs") ResponseEntity<Map<String, Object>> create(@RequestBody Map<String, Object> body, HttpServletRequest request, HttpServletResponse response) {
        return ResponseEntity.accepted().body(view(jobs.create(owner(request, response), body)));
    }
    @GetMapping("/api/v1/export-jobs/{id}") Map<String, Object> status(@PathVariable String id, HttpServletRequest request, HttpServletResponse response) { return view(jobs.owned(owner(request, response), id)); }
    @GetMapping("/api/v1/export-jobs/{id}/download") ResponseEntity<FileSystemResource> download(@PathVariable String id, HttpServletRequest request, HttpServletResponse response) {
        var resource = new FileSystemResource(jobs.result(jobs.owned(owner(request, response), id)));
        return ResponseEntity.ok().contentType(MediaType.APPLICATION_PDF).header("Content-Disposition", "attachment; filename=er-diagram.pdf").body(resource);
    }
    @ExceptionHandler(ResponseStatusException.class) ResponseEntity<Map<String, String>> expected(ResponseStatusException e) {
        return ResponseEntity.status(e.getStatusCode()).body(Map.of("message", Objects.toString(e.getReason(), "请求失败")));
    }
    @ExceptionHandler(org.springframework.http.converter.HttpMessageNotReadableException.class) ResponseEntity<Map<String, String>> badBody() {
        return ResponseEntity.badRequest().body(Map.of("message", "请求内容不是有效的项目数据"));
    }
}
