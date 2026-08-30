# my-music-app Android — 빌드 가이드

> render-ext(`C:\01_Labs\render-ext\android`)와 같은 패턴: `WebViewAssetLoader`로
> `10_app/`을 https 가상 출처(`appassets.androidplatform.net`)로 서빙하는 네이티브 WebView
> 래퍼. TWA/PWABuilder가 아니다 — 상세 이유는 `00_META/decisions.md` #58.

## 왜 지금 당장은 빌드가 안 되는가

이 머신에 **Android SDK는 있지만(`%LOCALAPPDATA%\Android\Sdk`) JDK가 없다.** Gradle이
Java 위에서 도는 도구라 JDK 없이는 한 줄도 못 돌린다. (render-ext를 만들 때는 아마 임시로
설치했다가 지웠거나, 다른 방법을 쓴 것으로 보임 — 지금은 흔적이 없음.)

## 준비 (한 번만)

Nick이 이미 scoop을 쓰고 있으니(`gh` 설치 확인됨) 같은 방식으로:

```powershell
scoop bucket add java
scoop install temurin17-jdk
scoop install gradle
```

설치 후 새 터미널에서 확인:
```powershell
java -version     # 17.x가 보이면 OK
gradle -version
```

## 빌드

`android/` 폴더에서:
```powershell
gradle assembleDebug
```
성공하면 `android/app/build/outputs/apk/debug/app-debug.apk`가 생긴다. 이 파일을 폰에
옮겨서 설치하면 된다(출처를 알 수 없는 앱 설치 허용 필요 — Android가 설치 시 안내함).

## 서명(릴리스용, 나중에)

디버그 APK는 자체 서명이라 바로 설치는 되지만, "진짜 내 앱"으로 두고 계속 업데이트하려면
릴리스 키스토어가 필요하다. 이건 **Nick이 생성 시점에 비밀번호를 정하고 파일을 안전한 곳에
백업**해야 하는 부분 — 키를 잃으면 같은 앱으로 인식되는 업데이트를 다시는 낼 수 없다.
`.gitignore`에 이미 `*.jks`/`*.keystore`/`keystore.properties`를 막아뒀다(레포에 올라가면
안 됨). 이 단계는 디버그 APK로 실제 설치·동작을 확인한 뒤에 진행한다.

## 코드를 고치면

`10_app/`이 `app/build.gradle.kts`의 `sourceSets.main.assets.srcDir`로 그대로 물려 있다 —
웹 앱을 고치고 다시 `gradle assembleDebug`만 돌리면 APK에 반영된다. 별도 복사·동기화 없음.
