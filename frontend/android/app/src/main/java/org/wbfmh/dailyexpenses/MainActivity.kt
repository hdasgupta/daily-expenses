package org.wbfmh.dailyexpenses

import android.os.Bundle
import com.capacitorjs.plugins.filesystem.FilesystemPlugin
import com.getcapacitor.BridgeActivity

class MainActivity : BridgeActivity() {

    private var credentialVault: CredentialVault? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        // Explicitly register the Capacitor Filesystem plugin.
        // This is required for the native Android bridge used by PDF export.
        registerPlugin(FilesystemPlugin::class.java)

        super.onCreate(savedInstanceState)

        val webView = bridge.webView ?: return

        val vault = CredentialVault(
            activity = this,
            webView = webView,
        )

        credentialVault = vault

        webView.settings.javaScriptEnabled = true

        webView.addJavascriptInterface(
            vault,
            "DailyExpensesCredentialVault",
        )
    }

    override fun onDestroy() {
        bridge.webView?.removeJavascriptInterface(
            "DailyExpensesCredentialVault",
        )

        credentialVault = null

        super.onDestroy()
    }
}
