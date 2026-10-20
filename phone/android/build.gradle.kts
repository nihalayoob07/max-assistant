plugins {
    id("com.android.application") version "8.10.1" apply false
    id("org.jetbrains.kotlin.android") version "2.1.0" apply false
    id("com.google.gms.google-services") version "4.4.2" apply false
}

// Build output outside the project folder (handy when the repo sits in a synced folder).
val localBuildRoot = System.getenv("LOCALAPPDATA")?.let { file("$it/max-phone-build") }
if (localBuildRoot != null) {
    allprojects {
        layout.buildDirectory.set(File(localBuildRoot, name))
    }
}
