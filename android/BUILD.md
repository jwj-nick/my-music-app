# my-music-app Android — 빌드 가이드

> render-ext(`C:\01_Labs\render-ext\android`)와 같은 패턴: `WebViewAssetLoader`로
> `10_app/`을 https 가상 출처(`appassets.androidplatform.net`)로 서빙하는 네이티브 WebView
> 래퍼. TWA/PWABuilder가 아니다 — 상세 이유는 `00_META/decisions.md` #59.

## 2026-08-30 — 첫 빌드 성공 (decisions.md #60)

JDK가 없어서 막혔던 것을 Claude가 scoop으로 직접 설치해 해결, `gradle assembleDebug`로
`app-debug.apk`(1.2MB) 빌드 성공, Nick에게 전달 완료. 아래는 재현 방법(다음 빌드 때 참고).

## 준비 (한 번만, 이미 완료됨)

```powershell
scoop bucket add java
scoop install temurin17-jdk   # Eclipse Temurin JDK 17, ~182MB
scoop install gradle          # 9.7.1, ~246MB
```

이 세션에서는 scoop이 갱신한 PATH가 바로 안 잡혀서 절대경로로 직접 불렀다:
```powershell
$env:JAVA_HOME = "C:\Users\admin\scoop\apps\temurin17-jdk\current"
& "C:\Users\admin\scoop\apps\gradle\current\bin\gradle.bat" -version
```
새 터미널을 열면 `java -version`/`gradle -version`이 PATH로 바로 될 가능성이 높다(scoop이
사용자 PATH에 shim을 추가해둠 — 새 프로세스부터 반영).

## SDK 경로 지정 (한 번만, 이미 완료됨)

`android/local.properties`(gitignore됨, 머신마다 다시 만들어야 함):
```
sdk.dir=C:\\Users\\admin\\AppData\\Local\\Android\\Sdk
```

## compileSdk 경고

로컬 SDK에 platform 34/36만 있어 `compileSdk=36`을 씀 — AGP 8.7.3의 공식 테스트 범위(~35)
밖이라 경고가 뜨지만 빌드엔 문제없다. `gradle.properties`의
`android.suppressUnsupportedCompileSdk=36`으로 경고만 억제해둠.

## 빌드

`android/` 폴더에서:
```powershell
$env:JAVA_HOME = "C:\Users\admin\scoop\apps\temurin17-jdk\current"
& "C:\Users\admin\scoop\apps\gradle\current\bin\gradle.bat" assembleDebug
```
(PATH가 잡힌 새 터미널이면 `gradle assembleDebug`만으로 충분)

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
