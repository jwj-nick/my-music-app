package dev.jwjnick.mymusicapp;

/*
 * my-music-app for Android — a thin native shell around the SAME web app the
 * browser serves. Pattern borrowed from render-ext's android/ module.
 *
 * The page is served over https://appassets.androidplatform.net rather than
 * file://, so fetch() to api.anthropic.com / googleapis.com, localStorage and
 * the sw.js service worker all behave exactly as they do on GitHub Pages
 * (decisions.md #12 — file:// breaks fetch(), this is the fix for Phase 3).
 *
 * Two things render-ext didn't need, because this app is network-first:
 *   1. INTERNET permission (AndroidManifest.xml) — AI/YouTube calls need it.
 *   2. onCreateWindow() below — target="_blank" links and the "YouTube 앱에서
 *      재생" button call window.open(); a bare WebView silently swallows that
 *      unless we hand it to the system (which is what actually opens the
 *      YouTube app instead of a dead click).
 */

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.os.Message;
import android.util.Log;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.webkit.WebSettingsCompat;
import androidx.webkit.WebViewAssetLoader;
import androidx.webkit.WebViewFeature;

public class MainActivity extends Activity {

    private static final String TAG = "my-music-app";
    private static final String ORIGIN = "https://appassets.androidplatform.net";
    private static final String START_URL = ORIGIN + "/assets/index.html";

    private WebView web;
    private WebViewAssetLoader loader;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        loader = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        web = new WebView(this);
        setContentView(web, new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true); // 앱의 취향 데이터·API 키가 전부 localStorage에 삶
        // 앱은 https 가상 출처로만 서빙된다 — file://·content:// 접근은 필요 없다.
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(true);
        // window.open()으로 새 창을 시도하는 링크(YouTube 앱 전환 등)를 받으려면 필요.
        s.setJavaScriptCanOpenWindowsAutomatically(true);
        s.setSupportMultipleWindows(true);

        if (WebViewFeature.isFeatureSupported(WebViewFeature.ALGORITHMIC_DARKENING)) {
            WebSettingsCompat.setAlgorithmicDarkeningAllowed(s, true);
        }

        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return loader.shouldInterceptRequest(request.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri u = request.getUrl();
                if (u != null && ORIGIN.replace("https://", "").equals(u.getHost())) {
                    return false; // 우리 앱 자신
                }
                openExternally(u);
                return true;
            }
        });

        // target="_blank" / window.open() — 카드의 Spotify·YouTube 링크, "YouTube 앱에서
        // 재생" 버튼이 여기로 온다. 임시 WebView로 목적지 URL만 받아서 시스템에 넘긴다.
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onCreateWindow(WebView view, boolean isDialog, boolean isUserGesture, Message resultMsg) {
                WebView temp = new WebView(MainActivity.this);
                temp.setWebViewClient(new WebViewClient() {
                    @Override
                    public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest request) {
                        openExternally(request.getUrl());
                        return true;
                    }
                });
                WebView.WebViewTransport transport = (WebView.WebViewTransport) resultMsg.obj;
                transport.setWebView(temp);
                resultMsg.sendToTarget();
                return true;
            }
        });

        web.addJavascriptInterface(new Bridge(), "AndroidBridge");

        web.loadUrl(START_URL);
    }

    private void openExternally(Uri u) {
        if (u == null) return;
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, u));
        } catch (Exception e) {
            Log.w(TAG, "no handler for " + u, e);
        }
    }

    /**
     * app.js의 requestWakeLock()/releaseWakeLock()이 이 브리지도 함께 호출한다 —
     * 웹 Wake Lock API가 WebView에서 안 먹힐 수 있어서, 네이티브 플래그로 확실하게
     * 보강한다(decisions.md #40에서 이미 예정해둔 것).
     */
    private class Bridge {
        @JavascriptInterface
        public void keepScreenOn(boolean on) {
            runOnUiThread(() -> {
                if (on) {
                    getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                } else {
                    getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                }
            });
        }
    }

    @Override
    protected void onDestroy() {
        if (web != null) {
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }
}
