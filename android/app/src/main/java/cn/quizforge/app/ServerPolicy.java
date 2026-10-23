package cn.quizforge.app;

import java.net.URI;
import java.util.Locale;

/** Shared by navigation, downloads and update checks; no Android dependencies. */
public final class ServerPolicy {
    private ServerPolicy() {}

    public static String normalize(String value) {
        try {
            URI uri = new URI(value.trim());
            String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
            String path = uri.getRawPath();
            int port = uri.getPort();
            if ((!scheme.equals("https") && !scheme.equals("http")) || uri.getHost() == null
                    || uri.getRawUserInfo() != null || uri.getRawQuery() != null || uri.getRawFragment() != null
                    || (path != null && !path.isEmpty() && !path.equals("/")) || port == 0 || port > 65535) {
                throw new IllegalArgumentException();
            }
            return scheme + "://" + uri.getRawAuthority().toLowerCase(Locale.ROOT);
        } catch (Exception error) {
            throw new IllegalArgumentException("请输入完整的服务器地址，例如 https://study.example.com 或 http://IP:端口");
        }
    }

    public static boolean sameOrigin(String server, String value) {
        try {
            URI base = URI.create(server), target = URI.create(value);
            return target.getRawUserInfo() == null && base.getScheme().equalsIgnoreCase(target.getScheme())
                    && base.getHost().equalsIgnoreCase(target.getHost()) && port(base) == port(target);
        } catch (Exception error) { return false; }
    }

    public static boolean isDownload(String server, String value) {
        if (!sameOrigin(server, value)) return false;
        String path = URI.create(value).getPath();
        return path != null && (path.matches("/downloads/[a-f0-9]{64}") || path.equals("/sample-bank.md"));
    }

    public static boolean isApk(String server, String value) {
        if (!sameOrigin(server, value)) return false;
        URI uri = URI.create(value);
        return uri.getPath() != null && uri.getPath().startsWith("/android/")
                && uri.getPath().endsWith(".apk") && uri.getQuery() == null && uri.getFragment() == null;
    }

    private static int port(URI uri) {
        return uri.getPort() == -1 ? ("https".equalsIgnoreCase(uri.getScheme()) ? 443 : 80) : uri.getPort();
    }
}
