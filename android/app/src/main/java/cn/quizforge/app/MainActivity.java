package cn.quizforge.app;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.DownloadManager;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.CookieManager;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebMessage;
import android.webkit.WebMessagePort;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;
import org.json.JSONObject;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class MainActivity extends Activity {
    private static final int FILE_REQUEST = 40;
    private static final int CANVAS = Color.rgb(247, 248, 242);
    private final ExecutorService network = Executors.newSingleThreadExecutor();
    private final UpdateReminder updateReminder = new UpdateReminder();
    private final Handler handler = new Handler(Looper.getMainLooper());
    private SharedPreferences preferences;
    private CredentialVault credentials;
    private String autofillScript = "";
    private String appControlsScript = "", appChannelId = "";
    private WebMessagePort appPort;
    private boolean resumed, checkingLogin;
    private WebView web;
    private ProgressBar progress;
    private LinearLayout errorPanel;
    private TextView errorText;
    private ValueCallback<Uri[]> fileCallback;
    private String server = "", loadedRevision = "", latestRevision = "", latestApk = "", latestApkVersion = "";
    private boolean checking, loadingFailed, appSignedIn;
    private final Runnable periodicCheck = new Runnable() {
        @Override public void run() { checkVersion(false); handler.postDelayed(this, 300_000); }
    };
    private final Runnable loginCheck = new Runnable() {
        @Override public void run() {
            if (!resumed) return;
            checkLoginForm();
            handler.postDelayed(this, 1500);
        }
    };

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        preferences = getSharedPreferences("quizforge", MODE_PRIVATE);
        credentials = new CredentialVault(this);
        try (java.io.InputStream input = getAssets().open("login-autofill.js")) {
            java.io.ByteArrayOutputStream buffer = new java.io.ByteArrayOutputStream();
            byte[] bytes = new byte[4096]; int count;
            while ((count = input.read(bytes)) != -1) buffer.write(bytes, 0, count);
            autofillScript = new String(buffer.toByteArray(), StandardCharsets.UTF_8);
        } catch (java.io.IOException error) { toast("自动填入组件不可用，请重新安装 App"); }
        try (java.io.InputStream input = getAssets().open("app-controls.js")) {
            java.io.ByteArrayOutputStream buffer = new java.io.ByteArrayOutputStream();
            byte[] bytes = new byte[4096]; int count;
            while ((count = input.read(bytes)) != -1) buffer.write(bytes, 0, count);
            appControlsScript = new String(buffer.toByteArray(), StandardCharsets.UTF_8);
        } catch (java.io.IOException error) { toast("App 设置组件不可用，请重新安装 App"); }
        server = preferences.getString("server", "http://49.234.185.199:3080");
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(CANVAS);
        // Android 15 draws behind system bars by default; consume both bars and keyboard insets.
        if (Build.VERSION.SDK_INT >= 30) {
            root.setOnApplyWindowInsetsListener((view, insets) -> {
                android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.ime());
                view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
                return WindowInsets.CONSUMED;
            });
        }
        progress = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        root.addView(progress, new LinearLayout.LayoutParams(-1, dp(3)));
        FrameLayout content = new FrameLayout(this);
        root.addView(content, new LinearLayout.LayoutParams(-1, 0, 1));
        web = new WebView(this);
        content.addView(web, new FrameLayout.LayoutParams(-1, -1));
        errorPanel = new LinearLayout(this);
        errorPanel.setOrientation(LinearLayout.VERTICAL); errorPanel.setGravity(Gravity.CENTER);
        errorPanel.setPadding(dp(24), dp(24), dp(24), dp(24)); errorPanel.setBackgroundColor(Color.rgb(244, 248, 245));
        errorText = new TextView(this); errorText.setTextSize(17); errorText.setGravity(Gravity.CENTER);
        errorPanel.addView(errorText);
        Button retry = new Button(this); retry.setText("重新连接");
        retry.setOnClickListener(view -> loadHome()); errorPanel.addView(retry);
        Button settings = new Button(this); settings.setText("设置服务器地址");
        settings.setOnClickListener(view -> editServer()); errorPanel.addView(settings);
        content.addView(errorPanel, new FrameLayout.LayoutParams(-1, -1));
        errorPanel.setVisibility(View.GONE);
        setContentView(root);
        configureWebView();
        if (Build.VERSION.SDK_INT >= 33) {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::handleBack);
        }
        if (server.isEmpty()) { showError("欢迎使用雅思工坊\n请先设置你的网站服务器地址"); editServer(); }
        else { loadHome(); }
    }

    @android.annotation.SuppressLint("SetJavaScriptEnabled") // This SPA needs JS; navigation is origin-bound; only a main-frame, exact-origin message port is exposed.
    private void configureWebView() {
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setCacheMode(WebSettings.LOAD_NO_CACHE);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true); // Only Android's user-selected document URIs.
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setUserAgentString(settings.getUserAgentString() + " QuizForgeAndroid/" + BuildConfig.VERSION_NAME);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, false);
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (!request.isForMainFrame()) return !ServerPolicy.sameOrigin(server, uri.toString());
                return navigate(uri.toString());
            }
            @Override public void onPageStarted(WebView view, String url, android.graphics.Bitmap icon) {
                closeAppChannel();
                loadingFailed = false; progress.setVisibility(View.VISIBLE);
            }
            @Override public void onPageFinished(WebView view, String url) {
                progress.setVisibility(View.GONE);
                if (!loadingFailed && ServerPolicy.sameOrigin(server, url)) {
                    errorPanel.setVisibility(View.GONE); configureAppControls(); checkVersion(false); checkLoginForm();
                }
            }
            @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) showError("暂时无法连接服务器\n请检查网络、地址和服务器是否运行");
            }
            @Override public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse response) {
                if (request.isForMainFrame()) showError("服务器返回 " + response.getStatusCode() + "\n请稍后重试或核对地址");
            }
            @Override public void onReceivedSslError(WebView view, android.webkit.SslErrorHandler ssl, android.net.http.SslError error) {
                ssl.cancel(); showError("服务器证书无法验证\n请修复证书或核对服务器地址");
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public void onProgressChanged(WebView view, int value) { progress.setProgress(value); }
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                cancelFileChooser();
                fileCallback = callback;
                Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE); intent.setType("*/*");
                intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE);
                // Keep the system picker open to all documents: provider MIME labels for CSV/Markdown vary.
                try { startActivityForResult(intent, FILE_REQUEST); }
                catch (ActivityNotFoundException error) { cancelFileChooser(); toast("请安装系统文件管理器"); }
                return true;
            }
        });
        web.setDownloadListener((url, agent, disposition, mime, length) -> download(url, disposition, mime));
    }

    private boolean navigate(String value) {
        if (ServerPolicy.isApk(server, value)) { openBrowser(value); return true; }
        if (ServerPolicy.sameOrigin(server, value)) return false;
        Uri uri = Uri.parse(value);
        if ("https".equals(uri.getScheme()) || "http".equals(uri.getScheme())) {
            new AlertDialog.Builder(this).setTitle("在浏览器中打开链接？")
                .setMessage(uri.getHost()).setNegativeButton("取消", null)
                .setPositiveButton("打开", (dialog, which) -> openBrowser(value)).show();
        } else toast("此类链接暂不支持，请使用网站提供的下载入口");
        return true;
    }

    private void download(String value, String disposition, String mime) {
        progress.setVisibility(View.GONE);
        if (ServerPolicy.isApk(server, value)) { openBrowser(value); return; }
        if (!ServerPolicy.isDownload(server, value)) { toast("下载链接无效，请重新生成文件"); return; }
        // Public Downloads requires no storage permission on Android 10+.
        if (Build.VERSION.SDK_INT < 29) { openBrowser(value); return; }
        try {
            DownloadManager.Request request = new DownloadManager.Request(Uri.parse(value));
            String name = URLUtil.guessFileName(value, disposition, mime).replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]", "_");
            request.setTitle(name);
            if (mime != null && !mime.isEmpty()) request.setMimeType(mime);
            request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name);
            ((DownloadManager)getSystemService(DOWNLOAD_SERVICE)).enqueue(request);
            toast("已开始下载，请在系统下载记录中查看");
        } catch (RuntimeException error) { openBrowser(value); }
    }

    private void editServer() {
        EditText input = new EditText(this);
        input.setSingleLine(true); input.setText(server.isEmpty() ? "http://49.234.185.199:3080" : server);
        input.setInputType(android.text.InputType.TYPE_CLASS_TEXT | android.text.InputType.TYPE_TEXT_VARIATION_URI);
        LinearLayout box = new LinearLayout(this); box.setOrientation(LinearLayout.VERTICAL); box.setPadding(dp(24), dp(8), dp(24), 0);
        TextView note = new TextView(this);
        note.setText(R.string.server_note);
        box.addView(note); box.addView(input);
        AlertDialog dialog = new AlertDialog.Builder(this).setTitle("服务器地址").setView(box)
            .setNegativeButton("取消", null).setPositiveButton("保存并连接", null).create();
        dialog.setOnShowListener(ignored -> dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(view -> {
            try {
                String next = ServerPolicy.normalize(input.getText().toString());
                if (!server.equals(next)) {
                    cancelFileChooser(); web.stopLoading(); web.loadUrl("about:blank"); web.clearHistory();
                    loadedRevision = ""; latestRevision = ""; latestApk = ""; latestApkVersion = ""; updateReminder.reset();
                    server = next; preferences.edit().putString("server", server).apply();
                }
                dialog.dismiss(); loadHome();
            } catch (IllegalArgumentException error) { input.setError(error.getMessage()); }
        }));
        dialog.show();
    }

    private void handleAppAction(String action) {
        switch (action) {
            case "reload": confirmReload(); break;
            case "update": if (appSignedIn) checkVersion(true); break;
            case "server": new AlertDialog.Builder(this).setMessage("请先保存当前内容，再更换服务器地址。")
                .setNegativeButton("取消", null).setPositiveButton("继续", (dialog, which) -> editServer()).show(); break;
            case "about": new AlertDialog.Builder(this).setTitle("雅思工坊 " + BuildConfig.VERSION_NAME)
                .setMessage("雅思词汇 · 听说读写 · 语料库\n\n网页功能随服务器发布在线更新。更新安装包时由安卓系统确认安装，已有服务器地址会保留。\n\n服务器：" + server)
                .setPositiveButton("知道了", null).show(); break;
            default: break;
        }
    }

    private void checkLoginForm() {
        if (!resumed || checkingLogin || loadingFailed || !ServerPolicy.sameOrigin(server, web.getUrl())) return;
        final String origin = server;
        try { if (!credentials.contains(origin)) return; }
        catch (Exception error) { return; }
        checkingLogin = true;
        // Read only whether the known login form exists; never read passwords out of webpage inputs.
        web.evaluateJavascript("(()=>{if(location.origin!==new URL(" + JSONObject.quote(origin) + ").origin)return false;"
            + "const f=document.querySelector('#loginForm');if(!f||f.dataset.quizforgeAutofillChecked)return false;"
            + "f.dataset.quizforgeAutofillChecked='1';return true;})()", result -> {
                checkingLogin = false;
                if (resumed && origin.equals(server) && "true".equals(result)) fillSavedLogin(false);
            });
    }

    private void fillSavedLogin(boolean force) {
        if (autofillScript.isEmpty() || !ServerPolicy.sameOrigin(server, web.getUrl())) return;
        try {
            JSONObject value = credentials.read(server);
            if (value == null) return;
            value.put("origin", server).put("force", force);
            // Values go into the top document of this exact origin; no native JS bridge or localStorage password.
            web.evaluateJavascript(autofillScript.replace("__QUIZFORGE_AUTOFILL_CREDENTIALS__", value.toString()), null);
        } catch (Exception error) { toast("已保存密码无法读取，请在登录页取消保存后重新登录"); }
    }

    private void closeAppChannel() {
        appSignedIn = false;
        appChannelId = "";
        if (appPort != null) { appPort.close(); appPort = null; }
    }

    private void configureAppControls() {
        if (appControlsScript.isEmpty() || !ServerPolicy.sameOrigin(server, web.getUrl())) return;
        closeAppChannel();
        final String origin = server, channelId = java.util.UUID.randomUUID().toString();
        appChannelId = channelId;
        try {
            JSONObject config = new JSONObject().put("origin", origin).put("nonce", channelId).put("remember", credentials.contains(origin));
            web.evaluateJavascript(appControlsScript.replace("__QUIZFORGE_APP_CONTROLS__", config.toString()), ready -> {
                if (!"true".equals(ready) || !channelId.equals(appChannelId) || !origin.equals(server) || !ServerPolicy.sameOrigin(origin, web.getUrl())) return;
                WebMessagePort[] channel = web.createWebMessageChannel();
                appPort = channel[0];
                appPort.setWebMessageCallback(new WebMessagePort.WebMessageCallback() {
                    @Override public void onMessage(WebMessagePort port, WebMessage message) {
                        if (port != appPort || !channelId.equals(appChannelId) || !origin.equals(server) || !ServerPolicy.sameOrigin(origin, web.getUrl())) return;
                        String data = message.getData();
                        if (data == null || data.length() > 32768) return;
                        try {
                            JSONObject value = new JSONObject(data);
                            if ("session".equals(value.optString("action"))) {
                                appSignedIn = value.optBoolean("signedIn", false);
                                if (appSignedIn) { promptAvailableUpdate(); checkVersion(false); }
                                return;
                            }
                            if ("forget".equals(value.optString("action"))) { credentials.clear(origin); return; }
                            if (!"save".equals(value.optString("action"))) { handleAppAction(value.optString("action")); return; }
                            credentials.save(origin, value.getString("username"), value.getString("password"));
                            toast("密码已在本机加密保存");
                        } catch (Exception error) { toast("App 操作未完成，请重试"); }
                    }
                });
                // A concrete target origin transfers the port to the main frame, never '*'.
                web.postWebMessage(new WebMessage(channelId, new WebMessagePort[]{channel[1]}), Uri.parse(origin));
                notifyAppState();
            });
        } catch (Exception error) { toast("App 设置暂不可用，请重新加载页面"); }
    }

    private void notifyAppState() {
        if (appPort == null || !ServerPolicy.sameOrigin(server, web.getUrl())) return;
        try {
            JSONObject value = new JSONObject().put("type", "state").put("appUpdate", !latestApk.isEmpty())
                .put("pageUpdate", !loadedRevision.isEmpty() && !loadedRevision.equals(latestRevision));
            appPort.postMessage(new WebMessage(value.toString()));
        } catch (Exception ignored) { /* The document may have navigated before this status arrived. */ }
    }

    private void confirmReload() {
        new AlertDialog.Builder(this).setTitle("重新加载最新页面？")
            .setMessage("请先保存当前答题、笔记或表单内容，重新加载会清除未保存的输入。")
            .setNegativeButton("继续当前操作", null).setPositiveButton("已保存，继续", (dialog, which) -> {
                loadedRevision = latestRevision; notifyAppState();
                errorPanel.setVisibility(View.GONE);
                if (!ServerPolicy.sameOrigin(server, web.getUrl())) loadHome(); else web.reload();
            }).show();
    }

    private void checkVersion(boolean manual) {
        if (server.isEmpty() || checking) { if (manual) toast("请先连接服务器，或等待当前检查完成"); return; }
        checking = true;
        final String origin = server;
        network.execute(() -> {
            JSONObject data = null;
            HttpURLConnection connection = null;
            try {
                connection = (HttpURLConnection)new URL(origin + "/api/app-version").openConnection();
                connection.setInstanceFollowRedirects(false);
                connection.setConnectTimeout(6000); connection.setReadTimeout(6000);
                connection.setUseCaches(false); connection.setRequestProperty("Cache-Control", "no-cache");
                if (connection.getResponseCode() != 200) throw new IllegalStateException();
                try (java.io.InputStream input = connection.getInputStream()) {
                    java.io.ByteArrayOutputStream buffer = new java.io.ByteArrayOutputStream();
                    byte[] chunk = new byte[4096];
                    int count;
                    while ((count = input.read(chunk)) != -1) {
                        if (buffer.size() + count > 65536) throw new IllegalStateException();
                        buffer.write(chunk, 0, count);
                    }
                    data = new JSONObject(new String(buffer.toByteArray(), StandardCharsets.UTF_8));
                }
            } catch (Exception ignored) { /* Existing servers can still load without update metadata. */ }
            finally { if (connection != null) connection.disconnect(); }
            final JSONObject result = data;
            runOnUiThread(() -> {
                checking = false;
                if (isDestroyed() || !origin.equals(server)) return;
                if (result == null) {
                    if (manual) toast("暂时无法检测版本，请稍后重试");
                    return;
                }
                String revision = result.optString("webRevision", "");
                if (revision.matches("[a-f0-9]{64}")) {
                    latestRevision = revision;
                    if (loadedRevision.isEmpty() && !loadingFailed) loadedRevision = revision;
                }
                JSONObject apk = result.optJSONObject("android");
                latestApk = ""; latestApkVersion = "";
                if (apk != null && apk.optInt("versionCode", 0) > BuildConfig.VERSION_CODE) {
                    String value = origin + apk.optString("apkPath", "");
                    if (ServerPolicy.isApk(origin, value)) { latestApk = value; latestApkVersion = apk.optString("versionName", ""); }
                }
                notifyAppState();
                if (manual) {
                    if (!latestApk.isEmpty()) showUpdate(); else toast("App 已是最新版本 " + BuildConfig.VERSION_NAME);
                } else promptAvailableUpdate();
            });
        });
    }

    private void promptAvailableUpdate() {
        // Silent before login. One reminder per APK during this app opening; manual checks stay available.
        if (!updateReminder.shouldPrompt(appSignedIn, resumed, latestApk)) return;
        showUpdate();
    }

    private void showUpdate() {
        if (appSignedIn && !latestApk.isEmpty()) {
            final String value = latestApk;
            updateReminder.record(value);
            new AlertDialog.Builder(this).setTitle("发现新版 App " + latestApkVersion)
                .setMessage("将使用浏览器下载安装包，再由安卓系统确认安装。请先保存当前内容。")
                .setNegativeButton("稍后", null).setPositiveButton("立即更新", (d, w) -> openBrowser(value)).show();
        }
    }

    private void loadHome() {
        if (server.isEmpty()) { editServer(); return; }
        errorPanel.setVisibility(View.GONE); loadingFailed = false;
        web.loadUrl(server + "/");
    }
    private void showError(String text) {
        loadingFailed = true; progress.setVisibility(View.GONE);
        errorText.setText(text); errorPanel.setVisibility(View.VISIBLE);
    }
    private void openBrowser(String value) {
        try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(value))); }
        catch (ActivityNotFoundException error) { toast("未找到浏览器，请安装浏览器后重试"); }
    }
    private void cancelFileChooser() { if (fileCallback != null) { fileCallback.onReceiveValue(null); fileCallback = null; } }
    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request != FILE_REQUEST || fileCallback == null) return;
        ArrayList<Uri> values = new ArrayList<>();
        if (result == RESULT_OK && data != null) {
            if (data.getClipData() != null) for (int i = 0; i < data.getClipData().getItemCount(); i++) values.add(data.getClipData().getItemAt(i).getUri());
            else if (data.getData() != null) values.add(data.getData());
        }
        // Never expose file:// or arbitrary remote URIs supplied by another app.
        values.removeIf(uri -> !"content".equals(uri.getScheme()));
        fileCallback.onReceiveValue(values.isEmpty() ? null : values.toArray(new Uri[0])); fileCallback = null;
    }
    @Override public void onBackPressed() { handleBack(); }
    private void handleBack() {
        if (errorPanel.getVisibility() != View.VISIBLE && web.canGoBack()) web.goBack();
        else new AlertDialog.Builder(this).setMessage("退出雅思工坊？请先保存当前内容。")
            .setNegativeButton("取消", null).setPositiveButton("退出", (d, w) -> finish()).show();
    }
    @Override protected void onResume() { super.onResume(); resumed = true; if (web != null) web.onResume(); handler.postDelayed(periodicCheck, 1500); handler.postDelayed(loginCheck, 500); }
    @Override protected void onPause() { resumed = false; handler.removeCallbacks(periodicCheck); handler.removeCallbacks(loginCheck); if (web != null) web.onPause(); super.onPause(); }
    @Override protected void onDestroy() {
        closeAppChannel();
        handler.removeCallbacks(periodicCheck); handler.removeCallbacks(loginCheck); cancelFileChooser(); network.shutdownNow();
        if (web != null) { web.stopLoading(); web.destroy(); }
        super.onDestroy();
    }
    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }
    private void toast(String text) { Toast.makeText(this, text, Toast.LENGTH_LONG).show(); }
}
