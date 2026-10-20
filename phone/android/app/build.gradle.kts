import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}
// Push needs your own Firebase project: drop its google-services.json into app/ and rebuild.
// Without it the app still builds (no ringing from the server, the in-app test call still works).
if (file("google-services.json").exists()) apply(plugin = "com.google.gms.google-services")

// Where the phone API is and its key: phone.properties (git-ignored), e.g.
//   urls=http://100.x.y.z:18660,http://192.168.1.50:18660   (Tailscale address first, then the home network)
//   key=<contents of ~/.config/max-phone/key on the server>
val phone = Properties().apply { rootProject.file("phone.properties").takeIf { it.exists() }?.inputStream()?.use { load(it) } }

android {
    namespace = "app.max.assistant"
    compileSdk = 36

    defaultConfig {
        applicationId = "app.max.assistant"
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0"
        buildConfigField("String", "MAX_URLS", "\"${phone.getProperty("urls", "http://127.0.0.1:18660")}\"")
        buildConfigField("String", "MAX_KEY", "\"${phone.getProperty("key", "")}\"")
    }

    buildFeatures { buildConfig = true }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }

    // The dashboard is the desktop app's own UI (max-assistant/app/ui), copied in at build time.
    sourceSets["main"].assets.srcDir(layout.buildDirectory.dir("shared-ui"))
}

val sharedUi by tasks.registering(Sync::class) {
    val app = rootProject.file("../../app")
    into(layout.buildDirectory.dir("shared-ui/www"))
    from(app.resolve("ui")) { include("app.js", "style.css") }
    listOf("rajdhani" to listOf("500", "600", "700"), "jetbrains-mono" to listOf("400", "600")).forEach { (font, weights) ->
        from(app.resolve("node_modules/@fontsource/$font")) {
            include(weights.map { "$it.css" })
            include(weights.map { "files/*-latin-$it-normal.woff2" })
            into("fonts/$font")
        }
    }
}
tasks.named("preBuild") { dependsOn(sharedUi) }

dependencies {
    implementation("com.google.firebase:firebase-messaging:24.1.0")
}
