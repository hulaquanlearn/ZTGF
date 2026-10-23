package cn.quizforge.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import org.json.JSONObject;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.KeyStore;
import java.security.MessageDigest;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;

/** Only ciphertext is written to app-private preferences. The AES key stays in Android Keystore. */
public final class CredentialVault {
    private static final String KEY_ALIAS = "quizforge.saved-passwords.v1";
    private final SharedPreferences preferences;

    public CredentialVault(Context context) {
        preferences = context.getSharedPreferences("quizforge-credentials", Context.MODE_PRIVATE);
    }

    public boolean contains(String server) throws Exception { return preferences.contains(recordKey(server)); }

    public JSONObject read(String server) throws Exception {
        String origin = ServerPolicy.normalize(server);
        String encrypted = preferences.getString(recordKey(origin), null);
        if (encrypted == null) return null;
        KeyStore store = KeyStore.getInstance("AndroidKeyStore"); store.load(null);
        SecretKey key = (SecretKey)store.getKey(KEY_ALIAS, null);
        if (key == null) throw new GeneralSecurityException("Credential key unavailable");
        return new JSONObject(CredentialCipher.decrypt(key, origin, encrypted));
    }

    public void save(String server, String username, String password) throws Exception {
        String origin = ServerPolicy.normalize(server);
        if (username.trim().isEmpty() || username.trim().length() > 60 || password.isEmpty() || password.length() > 4096) {
            throw new IllegalArgumentException("Invalid login fields");
        }
        KeyStore store = KeyStore.getInstance("AndroidKeyStore"); store.load(null);
        SecretKey key = (SecretKey)store.getKey(KEY_ALIAS, null);
        if (key == null) {
            KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
            generator.init(new KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setKeySize(256).setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).setRandomizedEncryptionRequired(true).build());
            key = generator.generateKey();
        }
        JSONObject value = new JSONObject().put("username", username.trim()).put("password", password);
        String encrypted = CredentialCipher.encrypt(key, origin, value.toString());
        if (!preferences.edit().putString(recordKey(origin), encrypted).commit()) throw new java.io.IOException("Could not persist credentials");
    }

    public void clear(String server) throws Exception {
        if (!preferences.edit().remove(recordKey(server)).commit()) throw new java.io.IOException("Could not clear credentials");
    }

    private static String recordKey(String server) throws Exception {
        byte[] digest = MessageDigest.getInstance("SHA-256").digest(ServerPolicy.normalize(server).getBytes(StandardCharsets.UTF_8));
        StringBuilder key = new StringBuilder("server-");
        for (byte value : digest) key.append(String.format(java.util.Locale.ROOT, "%02x", value & 0xff));
        return key.toString();
    }
}
