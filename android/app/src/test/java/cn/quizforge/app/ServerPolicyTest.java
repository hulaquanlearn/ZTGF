package cn.quizforge.app;

public final class ServerPolicyTest {
    private static void check(boolean ok) { if (!ok) throw new AssertionError(); }
    public static void main(String[] args) {
        check(ServerPolicy.normalize(" HTTPS://STUDY.EXAMPLE.COM/ ").equals("https://study.example.com"));
        check(ServerPolicy.normalize("http://49.234.185.199:3080").equals("http://49.234.185.199:3080"));
        check(ServerPolicy.normalize("http://[::1]:3080/").equals("http://[::1]:3080"));
        for (String invalid : new String[]{"javascript:alert(1)", "file:///data/", "https://user:pass@host", "https://host/path", "https://host?x=y", "https://host#x", "http://host:0", "http://host:99999", "http://host:-2"}) {
            try { ServerPolicy.normalize(invalid); throw new AssertionError(invalid); }
            catch (IllegalArgumentException expected) { /* Correctly rejected. */ }
        }
        String base = "https://study.example.com";
        check(ServerPolicy.sameOrigin(base, base + "/banks"));
        check(ServerPolicy.sameOrigin(base, "https://study.example.com:443/login"));
        for (String invalid : new String[]{"https://study.example.com.evil.test/", "https://study.example.com@evil.test/", "http://study.example.com/", "https://study.example.com:8443/", "intent://x", "javascript:alert(1)"}) check(!ServerPolicy.sameOrigin(base, invalid));
        check(ServerPolicy.isDownload(base, base + "/downloads/" + "a".repeat(64)));
        check(ServerPolicy.isDownload(base, base + "/sample-bank.md"));
        check(!ServerPolicy.isDownload(base, base + "/api/banks/export"));
        check(ServerPolicy.isApk(base, base + "/android/quizforge-1.1.apk"));
        check(!ServerPolicy.isApk(base, "https://evil.test/android/update.apk"));
        check(!ServerPolicy.isApk(base, base + "/android/update.apk?redirect=x"));
        System.out.println("Server policy: all checks passed");
    }
}
