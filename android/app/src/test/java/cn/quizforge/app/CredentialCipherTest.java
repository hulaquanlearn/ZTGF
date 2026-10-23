package cn.quizforge.app;

import java.security.GeneralSecurityException;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;

public final class CredentialCipherTest {
    private static void check(boolean value) { if (!value) throw new AssertionError(); }
    private static void rejects(SecretKey key, String origin, String record) throws Exception {
        try { CredentialCipher.decrypt(key, origin, record); throw new AssertionError("Accepted unauthenticated data"); }
        catch (GeneralSecurityException expected) { /* Correctly rejected. */ }
    }
    public static void main(String[] args) throws Exception {
        KeyGenerator generator = KeyGenerator.getInstance("AES"); generator.init(256);
        SecretKey key = generator.generateKey();
        String origin = "https://study.example.com", value = "Synthetic login: 学习账号 / test-only-pass";
        String first = CredentialCipher.encrypt(key, origin, value), second = CredentialCipher.encrypt(key, origin, value);
        check(value.equals(CredentialCipher.decrypt(key, origin, first)));
        check(!first.contains("test-only-pass")); check(!first.equals(second));
        rejects(key, "https://another.example.com", first);
        rejects(key, "http://study.example.com", first);
        rejects(generator.generateKey(), origin, first);
        String[] parts = first.split("\\.");
        byte[] changed = java.util.Base64.getDecoder().decode(parts[2]); changed[0] ^= 1;
        rejects(key, origin, parts[0] + "." + parts[1] + "." + java.util.Base64.getEncoder().encodeToString(changed));
        for (String invalid : new String[]{"", "v2.a.b", "v1.a.b", "v1..", "v1.a.b.c"}) rejects(key, origin, invalid);
        System.out.println("Credential encryption: round-trip, random IV, tampering and server isolation checks passed");
    }
}
