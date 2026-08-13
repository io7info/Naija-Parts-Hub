import java.util.Properties

/**
 * Release signing, read from a file that is never committed.
 *
 * `android/key.properties` holds the upload keystore's location and passwords.
 * It is gitignored, as are *.jks and *.keystore — a leaked upload key has to be
 * reset through Play support, and a leaked *app signing* key cannot be replaced
 * at all.
 *
 * Absent, release builds fail rather than falling back to the debug key. That
 * fallback is what this replaces: it produced APKs that installed and ran
 * perfectly while being unpublishable, and an app signed with the debug key can
 * never be upgraded to a properly signed one — the package has to be
 * uninstalled first. Failing loudly at build time is the cheapest place to
 * learn that.
 *
 * `-PallowUnsignedRelease=true` overrides it for a build that only needs to
 * verify compilation or inspect the bundle, never for one that ships.
 */
val keystoreProperties = Properties().apply {
    val file = rootProject.file("key.properties")
    if (file.exists()) file.inputStream().use { load(it) }
}

val hasReleaseKeystore = keystoreProperties.getProperty("storeFile") != null

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
    // Declaring it makes AGP eagerly resolve — and download — a multi-gigabyte
    // NDK on every configure, even though no module in this project compiles
    // native code: Firebase, flutter_image_compress and the rest all ship
    // prebuilt .so files inside their AARs.
    //
    // It is NOT what "Release app bundle failed to strip debug symbols" means,
    // despite the wording. AGP strips the .so files itself and writes the
    // symbols to BUNDLE-METADATA; Flutter then *verifies* that by running
    // `apkanalyzer`, which ships with the Android SDK Command-line Tools. With
    // those missing the verification cannot run and the build is failed even
    // though stripping worked — the presence of libflutter.so.sym in the bundle
    // is the proof. Setting ndkVersion changes nothing about that path; the fix
    // is to install cmdline-tools.
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

    signingConfigs {
        if (hasReleaseKeystore) {
            create("release") {
                // Resolved against android/, so key.properties can hold a path
                // outside the repository — which is where the keystore belongs.
                storeFile = rootProject.file(keystoreProperties.getProperty("storeFile"))
                storePassword = keystoreProperties.getProperty("storePassword")
                keyAlias = keystoreProperties.getProperty("keyAlias")
                keyPassword = keystoreProperties.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            if (hasReleaseKeystore) {
                signingConfig = signingConfigs.getByName("release")
            } else if (project.hasProperty("allowUnsignedRelease")) {
                // Debug-signed, deliberately and loudly. Installable for
                // inspection; rejected by Play, and not upgradeable to a real
                // build without uninstalling first.
                // lifecycle, not warn: Flutter filters Gradle's output and warn
                // only surfaces under --verbose. Best effort either way — the
                // real guard is that this branch needs an explicit flag, so
                // nobody reaches it without having asked for it.
                logger.lifecycle(
                    "\n*** Release build signed with the DEBUG key — android/key.properties " +
                        "is missing. This artifact cannot be published to Google Play. ***\n",
                )
                signingConfig = signingConfigs.getByName("debug")
            } else {
                throw GradleException(
                    """
                    Cannot build a release: android/key.properties is missing.

                    Create the upload keystore (once, and keep it outside this repository):

                      keytool -genkeypair -v -keystore C:\path\to\nph-upload.jks ^
                        -storetype JKS -keyalg RSA -keysize 2048 -validity 10000 -alias upload

                    Then create apps/mobile/android/key.properties:

                      storePassword=...
                      keyPassword=...
                      keyAlias=upload
                      storeFile=C:/path/to/nph-upload.jks

                    Both are gitignored. Losing the keystore means Play support has to
                    reset your upload key, so back it up somewhere durable.

                    To build an unpublishable artifact anyway, for inspection only:
                      flutter build apk --release -PallowUnsignedRelease=true
                    """.trimIndent(),
                )
            }

            // Shrinking is off deliberately. R8 rewrites the stack traces
            // Crashlytics symbolicates, and enabling it without uploading a
            // mapping file turns every production crash report into obfuscated
            // frames. Worth doing later, with the mapping upload wired up.
            isMinifyEnabled = false
            isShrinkResources = false
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
