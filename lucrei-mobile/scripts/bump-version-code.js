// Incrementa android.versionCode no app.json. Chamado automaticamente pelo
// build-android-local.sh antes de gerar um .aab, já que a Play Store rejeita
// qualquer upload cujo versionCode já tenha sido usado antes - esquecer esse
// passo foi a causa de dois uploads rejeitados nesta mesma sessão.
const fs = require('fs');
const path = require('path');

const appJsonPath = path.join(__dirname, '..', 'app.json');
const appJson = JSON.parse(fs.readFileSync(appJsonPath, 'utf8'));

const current = appJson.expo?.android?.versionCode;
if (typeof current !== 'number') {
  console.error('app.json não tem expo.android.versionCode definido como número.');
  process.exit(1);
}

appJson.expo.android.versionCode = current + 1;
fs.writeFileSync(appJsonPath, JSON.stringify(appJson, null, 2) + '\n');
console.log(`versionCode: ${current} -> ${appJson.expo.android.versionCode}`);
