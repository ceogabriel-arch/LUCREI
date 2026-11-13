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
//   - exclui o sub-projeto Gradle "sentry-react-native-expo" do autolinking -
//     o expo-modules-autolinking resolve o sourceDir desse projeto (só esse,
//     os outros módulos ficam com o caminho normal) pro caminho UNC puro
//     (\\matrix\usuario\filipe.lourenço\...) em vez do drive mapeado (Z:\...),
//     e o Gradle 9 não reconhece esse diretório como existente nesse caminho
//     UNC com acento (`ç`) - só acontece em build LOCAL nessa máquina; EAS
//     builda em Linux e não tem esse problema. Afeta só esse hook extra do
//     Sentry pro Expo, não o módulo nativo principal (crash reporting
//     continua linkado normalmente).
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
            signingConfig = signingConfigs.debug
        }
        release {
            // Caution! In production, you need to generate your own keystore file.
            // see https://reactnative.dev/docs/signed-apk-android.
            signingConfig = signingConfigs.debug`;

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
            signingConfig = signingConfigs.debug
        }
        release {
            signingConfig = ${releaseSigningConfig}`;

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

const settingsGradlePath = path.join(__dirname, '..', 'android', 'settings.gradle');
let settingsContent = fs.readFileSync(settingsGradlePath, 'utf8');

const useExpoModulesLine = 'expoAutolinking.useExpoModules()';
if (!settingsContent.includes(useExpoModulesLine)) {
  console.error('Linha "expoAutolinking.useExpoModules()" não encontrada em android/settings.gradle - ajuste este script.');
  process.exit(1);
}

settingsContent = settingsContent.replace(
  useExpoModulesLine,
  `expoAutolinking.exclude = ["@sentry/react-native"]\n${useExpoModulesLine}`,
);
fs.writeFileSync(settingsGradlePath, settingsContent);
console.log('android/settings.gradle atualizado (excluindo sentry-react-native-expo do autolinking local).');
