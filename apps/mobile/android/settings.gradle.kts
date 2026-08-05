pluginManagement {
    val flutterSdkPath =
        run {
            val properties = java.util.Properties()
            file("local.properties").inputStream().use { properties.load(it) }
            val flutterSdkPath = properties.getProperty("flutter.sdk")
            require(flutterSdkPath != null) { "flutter.sdk not set in local.properties" }
            flutterSdkPath
        }

    includeBuild("$flutterSdkPath/packages/flutter_tools/gradle")

    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

plugins {
    id("dev.flutter.flutter-plugin-loader") version "1.0.0"
    id("com.android.application") version "9.0.1" apply false
    // START: FlutterFire Configuration
    // Both pinned forward for Gradle 9 compatibility.
    //
    // crashlytics 2.8.1 (2022) calls groovy.util.XmlSlurper, which Gradle 9
    // removed, so `flutter build apk --release` failed at
    // :app:uploadCrashlyticsMappingFileRelease with a bare "groovy/util/
    // XmlSlurper". Debug builds never run that task, which is why this only
    // appeared the first time a release build was attempted.
    id("com.google.gms.google-services") version("4.4.2") apply false
    id("com.google.firebase.crashlytics") version("3.0.3") apply false
    // END: FlutterFire Configuration
    id("org.jetbrains.kotlin.android") version "2.3.20" apply false
}

include(":app")
