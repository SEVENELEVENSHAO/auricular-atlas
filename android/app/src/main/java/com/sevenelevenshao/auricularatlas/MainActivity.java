package com.sevenelevenshao.auricularatlas;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import androidx.webkit.WebViewAssetLoader;

import java.io.ByteArrayInputStream;
import java.io.OutputStream;
import java.util.Locale;

public final class MainActivity extends Activity {
    private static final int FILE_CHOOSER_REQUEST = 1001;
    private static final int CREATE_DOCUMENT_REQUEST = 1002;
    private static final String APP_ASSET_HOST = "appassets.androidplatform.net";

    private WebView viewer;
    private ValueCallback<Uri[]> fileChooserCallback;
    private byte[] pendingSave;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        viewer = new WebView(this);
        viewer.setBackgroundColor(0xff0f1a21);
        viewer.setLayerType(WebView.LAYER_TYPE_HARDWARE, null);
        setContentView(viewer);

        viewer.setOnApplyWindowInsetsListener((view, insets) -> {
            if (android.os.Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets bars = insets.getInsets(
                        android.view.WindowInsets.Type.systemBars()
                                | android.view.WindowInsets.Type.displayCutout());
                view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            }
            return insets;
        });

        WebSettings settings = viewer.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);

        WebViewAssetLoader assets = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        viewer.addJavascriptInterface(new AtlasFileBridge(), "AtlasFileBridge");
        viewer.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView webView,
                                             ValueCallback<Uri[]> callback,
                                             FileChooserParams params) {
                if (fileChooserCallback != null) {
                    fileChooserCallback.onReceiveValue(null);
                }
                fileChooserCallback = callback;
                try {
                    startActivityForResult(params.createIntent(), FILE_CHOOSER_REQUEST);
                    return true;
                } catch (Exception error) {
                    fileChooserCallback = null;
                    callback.onReceiveValue(null);
                    return false;
                }
            }
        });

        viewer.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                WebResourceResponse response = assets.shouldInterceptRequest(request.getUrl());
                if (response != null) return response;
                return new WebResourceResponse("text/plain", "UTF-8", 404, "Not found", null,
                        new ByteArrayInputStream(new byte[0]));
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                return !"https".equals(uri.getScheme()) || !APP_ASSET_HOST.equals(uri.getHost());
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                if (isAppAssetUrl(url)) view.evaluateJavascript(DOWNLOAD_BRIDGE_SCRIPT, null);
            }
        });

        viewer.loadUrl("https://" + APP_ASSET_HOST + "/assets/index.html");
    }

    private static boolean isAppAssetUrl(String url) {
        return url != null && url.startsWith("https://" + APP_ASSET_HOST + "/assets/");
    }

    private static final String DOWNLOAD_BRIDGE_SCRIPT = "(function(){"
            + "if(window.__atlasDownloadBridgeInstalled)return;window.__atlasDownloadBridgeInstalled=true;"
            + "document.addEventListener('click',function(event){"
            + "var link=event.target.closest&&event.target.closest('a[download]');"
            + "if(!link||!link.href.startsWith('blob:'))return;"
            + "event.preventDefault();event.stopImmediatePropagation();"
            + "fetch(link.href).then(function(response){return response.blob()}).then(function(blob){"
            + "var reader=new FileReader();reader.onload=function(){"
            + "window.AtlasFileBridge.saveBase64(link.download||'auricular-atlas.json',"
            + "blob.type||'application/json',reader.result.split(',')[1]);};"
            + "reader.readAsDataURL(blob);}).catch(function(){alert('Could not prepare the atlas backup.');});"
            + "},true);})();";

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == FILE_CHOOSER_REQUEST) {
            if (fileChooserCallback != null) {
                fileChooserCallback.onReceiveValue(
                        resultCode == RESULT_OK ? WebChromeClient.FileChooserParams.parseResult(resultCode, data) : null);
                fileChooserCallback = null;
            }
            return;
        }

        if (requestCode == CREATE_DOCUMENT_REQUEST) {
            byte[] dataToWrite = pendingSave;
            pendingSave = null;
            if (resultCode != RESULT_OK || data == null || data.getData() == null || dataToWrite == null) return;
            try (OutputStream output = getContentResolver().openOutputStream(data.getData())) {
                if (output == null) throw new IllegalStateException("Could not open the selected file.");
                output.write(dataToWrite);
                Toast.makeText(this, "Atlas backup saved", Toast.LENGTH_SHORT).show();
            } catch (Exception error) {
                Toast.makeText(this, "Could not save atlas backup", Toast.LENGTH_LONG).show();
            }
        }
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (viewer != null) viewer.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (viewer != null) viewer.onResume();
    }

    @Override
    protected void onDestroy() {
        if (viewer != null) {
            viewer.removeJavascriptInterface("AtlasFileBridge");
            viewer.destroy();
            viewer = null;
        }
        super.onDestroy();
    }

    private final class AtlasFileBridge {
        @JavascriptInterface
        public void saveBase64(String filename, String mimeType, String encodedData) {
            final byte[] bytes;
            try {
                bytes = android.util.Base64.decode(encodedData, android.util.Base64.DEFAULT);
            } catch (IllegalArgumentException error) {
                runOnUiThread(() -> Toast.makeText(MainActivity.this,
                        "Could not prepare atlas backup", Toast.LENGTH_LONG).show());
                return;
            }

            runOnUiThread(() -> {
                pendingSave = bytes;
                String safeName = filename == null ? "auricular-atlas.json" : filename;
                safeName = safeName.replaceAll("[^A-Za-z0-9._-]", "_");
                if (safeName.isEmpty()) safeName = "auricular-atlas.json";
                String safeMime = mimeType == null || !mimeType.contains("/")
                        ? "application/json" : mimeType.toLowerCase(Locale.ROOT);

                Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType(safeMime);
                intent.putExtra(Intent.EXTRA_TITLE, safeName);
                startActivityForResult(intent, CREATE_DOCUMENT_REQUEST);
            });
        }
    }
}
