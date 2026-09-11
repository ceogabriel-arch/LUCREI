// Reaplica nas configs geradas pelo `expo prebuild --clean` os ajustes que só
// fazem sentido pra build local (nunca commitados, já que android/ é
// gitignorado e regenerado do zero a cada prebuild):
//   - keystore de debug fixa (fora de android/, não a aleatória que o
//     template gera a cada prebuild - essa invalidava o SHA-1 cadastrado no
//     Google Cloud Console pro Google Sign-In a cada rebuild)
//   - signingConfig de release: debug (pra instalar direto e testar) ou
//     upload key (pra gerar o .aab de verdade pro Play Store)
//   - desativa o upload de source maps do Sentry (não tem SENTRY_ORG/
//     SENTRY_AUTH_TOKEN localmente, só existem nos secrets do EAS)
//
// Uso: node scripts/patch-android-build.js <apk|aab> <debugKeystorePath>
const fs = require('fs');
const path = require('path');

const [, , target, debugKeystorePath] = process.argv;
if (!['apk', 'aab'].includes(target) || !debugKeystorePath) {
  console.error('Uso: node scripts/patch-android-build.js <apk|aab> <debugKeystorePath>');
  process.exit(1);
}

const buildGradlePath = path.join(__dirname, '..', 'android', 'app', 'build.gradle');
let content = fs.readFileSync(buildGradlePath, 'utf8');

const debugStoreFile = debugKeystorePath.replace(/\\/g, '/');

const oldSigningBlock = `    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
    }
    buildTypes {
        debug {
            signingConfig signingConfigs.debug
        }
        release {
            // Caution! In production, you need to generate your own keystore file.
            // see https://reactnative.dev/docs/signed-apk-android.
            signingConfig signingConfigs.debug`;

if (!content.includes(oldSigningBlock)) {
  console.error('Bloco de signingConfigs esperado não encontrado - o template do expo prebuild deve ter mudado. Ajuste este script.');
  process.exit(1);
}

const releaseSigningConfig = target === 'aab' ? 'signingConfigs.release' : 'signingConfigs.debug';

const newSigningBlock = `    signingConfigs {
        debug {
            // Keystore fixa fora de android/ (sobrevive a \`expo prebuild --clean\`) -
            // a debug.keystore padrão é gerada aleatória a cada prebuild, o que
            // invalidava o SHA-1 cadastrado no Google Cloud Console pro Google
            // Sign-In a cada rebuild local.
            storeFile file('${debugStoreFile}')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
        release {
            storeFile file(MYAPP_UPLOAD_STORE_FILE)
            storePassword MYAPP_UPLOAD_STORE_PASSWORD
            keyAlias MYAPP_UPLOAD_KEY_ALIAS
            keyPassword MYAPP_UPLOAD_KEY_PASSWORD
        }
    }
    buildTypes {
        debug {
            signingConfig signingConfigs.debug
        }
        release {
            signingConfig ${releaseSigningConfig}`;

content = content.replace(oldSigningBlock, newSigningBlock);

const dependenciesMarker = 'dependencies {\n    // The version of react-native is set by the React Native Gradle Plugin';
if (!content.includes(dependenciesMarker)) {
  console.error('Marcador do bloco dependencies não encontrado - ajuste este script.');
  process.exit(1);
}

const sentryDisableBlock = `// Build local não tem SENTRY_ORG/SENTRY_AUTH_TOKEN (só existem nos secrets do EAS) -
// desativa o upload de source maps do Sentry pra não quebrar o build local.
afterEvaluate {
    tasks.matching { it.name.contains("SentryUpload") }.configureEach { enabled = false }
}

${dependenciesMarker}`;

content = content.replace(dependenciesMarker, sentryDisableBlock);

fs.writeFileSync(buildGradlePath, content);
console.log(`android/app/build.gradle atualizado (release assinado com ${releaseSigningConfig}).`);
