#!/usr/bin/env bash
# Builda o app Android localmente (sem EAS), do jeito estabelecido durante o
# lançamento na Play Store: `expo prebuild --clean` + Gradle direto.
#
# Uso:
#   scripts/build-android-local.sh apk           # APK de teste (arm64 só, assinado com debug key)
#   scripts/build-android-local.sh aab           # .aab pra Play Store (assinado com upload key, bump de versionCode automático)
#   scripts/build-android-local.sh aab --no-bump # .aab sem bumpar o versionCode
#
# Precisa de lucrei-mobile/.env.local-build (veja .env.local-build.example).
set -euo pipefail
cd "$(dirname "$0")/.."

TARGET="${1:-}"
if [[ "$TARGET" != "apk" && "$TARGET" != "aab" ]]; then
  echo "Uso: $0 <apk|aab> [--no-bump]" >&2
  exit 1
fi
NO_BUMP="${2:-}"

ENV_FILE=".env.local-build"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "Falta $ENV_FILE - copie de .env.local-build.example e preencha." >&2
  exit 1
fi
set -a
source "$ENV_FILE"
set +a

: "${ANDROID_SDK_DIR:?defina ANDROID_SDK_DIR em $ENV_FILE}"
: "${DEBUG_KEYSTORE_PATH:?defina DEBUG_KEYSTORE_PATH em $ENV_FILE}"
: "${UPLOAD_KEYSTORE_PATH:?defina UPLOAD_KEYSTORE_PATH em $ENV_FILE}"
: "${UPLOAD_KEYSTORE_ALIAS:?defina UPLOAD_KEYSTORE_ALIAS em $ENV_FILE}"
: "${UPLOAD_KEYSTORE_PASSWORD:?defina UPLOAD_KEYSTORE_PASSWORD em $ENV_FILE}"

# Java 17 instalado via winget (EclipseAdoptium.Temurin.17.JDK) - o patch
# exato muda com auto-updates, então acha a pasta em vez de fixar a versão.
JAVA_HOME_DIR=$(ls -d "/c/Program Files/Eclipse Adoptium"/jdk-17*-hotspot 2>/dev/null | sort -V | tail -1)
if [[ -z "$JAVA_HOME_DIR" ]]; then
  echo "Não achei um JDK 17 em /c/Program Files/Eclipse Adoptium/ - instale com: winget install --id EclipseAdoptium.Temurin.17.JDK" >&2
  exit 1
fi

if [[ "$TARGET" == "aab" && "$NO_BUMP" != "--no-bump" ]]; then
  node scripts/bump-version-code.js
fi

echo "== expo prebuild --clean =="
npx expo prebuild -p android --clean

echo "== reaplicando config local (SDK path, keystores, Sentry) =="
printf 'sdk.dir=%s\n' "$(printf '%s' "$ANDROID_SDK_DIR" | sed 's/\//\\\\/g')" > android/local.properties

cat >> android/gradle.properties <<EOF

MYAPP_UPLOAD_STORE_FILE=lucrei-upload-key.jks
MYAPP_UPLOAD_KEY_ALIAS=$UPLOAD_KEYSTORE_ALIAS
MYAPP_UPLOAD_STORE_PASSWORD=$UPLOAD_KEYSTORE_PASSWORD
MYAPP_UPLOAD_KEY_PASSWORD=$UPLOAD_KEYSTORE_PASSWORD
EOF

cp "$UPLOAD_KEYSTORE_PATH" android/app/lucrei-upload-key.jks

node scripts/patch-android-build.js "$TARGET" "$DEBUG_KEYSTORE_PATH"

export JAVA_HOME="$JAVA_HOME_DIR"
export ANDROID_HOME="$ANDROID_SDK_DIR"
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/cmdline-tools/latest/bin:$PATH"

echo "== gradle =="
cd android
if [[ "$TARGET" == "aab" ]]; then
  # .aab pra Play Store precisa de todas as arquiteturas (Play Store faz o
  # split por dispositivo) - exceto armeabi-v7a, que trava com um bug de
  # limite de caminho do Windows no CMake/Ninja (32-bit é irrelevante hoje).
  ./gradlew.bat bundleRelease -PreactNativeArchitectures=arm64-v8a,x86,x86_64
  echo ""
  echo "AAB pronto: android/app/build/outputs/bundle/release/app-release.aab"
else
  # APK de teste direto no celular - só arm64 (dispositivos modernos), fica bem menor.
  ./gradlew.bat assembleRelease -PreactNativeArchitectures=arm64-v8a
  echo ""
  echo "APK pronto: android/app/build/outputs/apk/release/app-release.apk"
fi
