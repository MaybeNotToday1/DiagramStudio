package studio.diagram;

import jakarta.servlet.*;
import jakarta.servlet.http.*;
import java.io.IOException;
import java.net.URI;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

@Component
class RequestGuard extends OncePerRequestFilter {
    private static final long MAX_BODY = 8 * 1024 * 1024;
    @Override protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain) throws ServletException, IOException {
        response.setHeader("X-Content-Type-Options", "nosniff");
        response.setHeader("Cache-Control", "no-store");
        if (!"POST".equals(request.getMethod())) { chain.doFilter(request, response); return; }
        String origin = request.getHeader("Origin"), host = request.getHeader("Host");
        boolean badOrigin = false;
        if (origin != null) {
            try { var uri = URI.create(origin); badOrigin = !uri.getRawAuthority().equalsIgnoreCase(host); }
            catch (RuntimeException e) { badOrigin = true; }
        }
        if (badOrigin || !"1".equals(request.getHeader("X-Diagram-Request"))) { response.sendError(403); return; }
        if (request.getContentLengthLong() > MAX_BODY) { response.sendError(413); return; }
        if (request.getContentType() == null || !request.getContentType().startsWith("application/json")) { response.sendError(415); return; }
        chain.doFilter(new HttpServletRequestWrapper(request) {
            @Override public ServletInputStream getInputStream() throws IOException {
                var source = request.getInputStream();
                return new ServletInputStream() {
                    long count;
                    private void check(int size) throws IOException { if (size > 0 && (count += size) > MAX_BODY) throw new IOException("Request too large"); }
                    public int read() throws IOException { int b = source.read(); check(b < 0 ? 0 : 1); return b; }
                    public int read(byte[] b, int off, int len) throws IOException { int size = source.read(b, off, len); check(size); return size; }
                    public boolean isFinished() { return source.isFinished(); }
                    public boolean isReady() { return source.isReady(); }
                    public void setReadListener(ReadListener listener) { source.setReadListener(listener); }
                };
            }
        }, response);
    }
}
