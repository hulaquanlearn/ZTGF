package cn.quizforge.app;

public final class UpdateReminderTest {
    public static void main(String[] args) {
        UpdateReminder reminder = new UpdateReminder();
        require(!reminder.shouldPrompt(false, true, "new.apk"), "No prompt on login screen");
        require(!reminder.shouldPrompt(true, false, "new.apk"), "No background dialog");
        require(reminder.shouldPrompt(true, true, "new.apk"), "Prompt after login");
        require(!reminder.shouldPrompt(true, true, "new.apk"), "Do not repeat while polling");
        require(!reminder.shouldPrompt(false, true, "new.apk"), "Logout remains silent");
        require(!reminder.shouldPrompt(true, true, "new.apk"), "Re-entry does not nag");
        require(reminder.shouldPrompt(true, true, "next.apk"), "A newer APK can prompt");
        require(!reminder.shouldPrompt(true, true, ""), "Current version has no prompt");
        reminder.reset();
        require(reminder.shouldPrompt(true, true, "next.apk"), "Server changes reset reminder scope");
        reminder.record("manual.apk");
        require(!reminder.shouldPrompt(true, true, "manual.apk"), "Manual dialog also counts");
        System.out.println("Update reminder policy checks passed");
    }
    private static void require(boolean value, String message) { if (!value) throw new AssertionError(message); }
}
