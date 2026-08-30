plugins {
    id("com.android.application")
}

android {
    namespace = "dev.jwjnick.mymusicapp"
    compileSdk = 36 // 로컬 SDK에 34/36만 설치돼 있어 36으로 맞춤(35 다운로드 회피)

    defaultConfig {
        applicationId = "dev.jwjnick.mymusicapp"
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0"
    }

    // 10_app/은 앱과 이 android 프로젝트가 통째로 공유한다 — vendoring도, 동기화 스크립트도
    // 없다. 웹에서 index.html/app.js/style.css를 고치면 이 APK도 다음 빌드에서 그대로 반영된다
    // (render-ext의 android/app 패턴을 그대로 따름 — "한 곳만 고치면 둘 다 갱신").
    sourceSets.getByName("main").assets.srcDir("../../10_app")

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    // WebViewAssetLoader: 번들 자산을 file://가 아니라 진짜 https 출처로 서빙 —
    // fetch()/localStorage/서비스워커가 브라우저에서와 똑같이 동작한다 (decisions.md #12).
    implementation("androidx.webkit:webkit:1.12.1")
}
