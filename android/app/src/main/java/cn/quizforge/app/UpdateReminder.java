package cn.quizforge.app;

/** A reminder belongs to a signed-in foreground session, once per APK per app opening. */
final class UpdateReminder {
    private String announced = "";

    boolean shouldPrompt(boolean signedIn, boolean foreground, String apk) {
        if (!signedIn || !foreground || apk.isEmpty() || apk.equals(announced)) return false;
        announced = apk;
        return true;
    }

    void record(String apk) { announced = apk; }
    void reset() { announced = ""; }
}
