plugins {
    id("com.android.application")
    // START: FlutterFire Configuration
    id("com.google.gms.google-services")
    id("com.google.firebase.crashlytics")
    // END: FlutterFire Configuration
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

android {
    namespace = "com.lytodmotors.naijapartshub"
    compileSdk = flutter.compileSdkVersion

    // ndkVersion is intentionally NOT set.
    //
    // Declaring it makes AGP eagerly resolve — and download — a ~1 GB NDK on
    // every configure, even though no module in this project compiles native
    // code: Firebase, flutter_image_compress and the rest all ship prebuilt
    // .so files inside their AARs.
    //
    // Re-enable with `ndkVersion = flutter.ndkVersion` if a dependency is ever
    // added that declares an externalNativeBuild (CMake / ndk-build). Install
    // the NDK first via Android Studio's SDK Manager, which resumes partial
    // downloads; Gradle's inline downloader does not, and a dropped connection
    // leaves an empty ndk/<version> directory that it then retries forever.

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    defaultConfig {
        // Must stay identical to the iOS bundle identifier, and can never be
        // changed once the app is published — Play treats a new applicationId
        // as a different app, with no reviews, ratings or install base.
        applicationId = "com.lytodmotors.naijapartshub"
        // You can update the following values to match your application needs.
        // For more information, see: https://flutter.dev/to/review-gradle-config.
        minSdk = flutter.minSdkVersion
        targetSdk = flutter.targetSdkVersion
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }

    buildTypes {
        release {
            // TODO: Add your own signing config for the release build.
            // Signing with the debug keys for now, so `flutter run --release` works.
            signingConfig = signingConfigs.getByName("debug")
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}

flutter {
    source = "../.."
}
