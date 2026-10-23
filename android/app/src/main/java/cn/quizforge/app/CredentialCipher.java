package cn.quizforge.app;

import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.util.Base64;
import javax.crypto.Cipher;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/** Authenticated encryption; the server origin is bound to each record. */
public final class CredentialCipher {
    private CredentialCipher() {}

    public static String encrypt(SecretKey key, String origin, String plaintext) throws GeneralSecurityException {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, key); // Let Android Keystore generate a fresh random IV.
        cipher.updateAAD(origin.getBytes(StandardCharsets.UTF_8));
        byte[] encrypted = cipher.doFinal(plaintext.getBytes(StandardCharsets.UTF_8));
        return "v1." + Base64.getEncoder().encodeToString(cipher.getIV()) + "." + Base64.getEncoder().encodeToString(encrypted);
    }

    public static String decrypt(SecretKey key, String origin, String record) throws GeneralSecurityException {
        try {
            if (record.length() > 65536) throw new IllegalArgumentException();
            String[] parts = record.split("\\.", -1);
            if (parts.length != 3 || !parts[0].equals("v1")) throw new IllegalArgumentException();
            byte[] iv = Base64.getDecoder().decode(parts[1]), encrypted = Base64.getDecoder().decode(parts[2]);
            if (iv.length != 12 || encrypted.length < 16) throw new IllegalArgumentException();
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(128, iv));
            cipher.updateAAD(origin.getBytes(StandardCharsets.UTF_8));
            return new String(cipher.doFinal(encrypted), StandardCharsets.UTF_8);
        } catch (IllegalArgumentException error) {
            throw new GeneralSecurityException("Invalid credential record", error);
        }
    }
}
