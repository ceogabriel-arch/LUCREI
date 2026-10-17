# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code.

# ⚠️ NUNCA apague ou regenere o keystore de upload do Android

`C:/Android/keystore/lucrei-upload-key.jks` (referenciado por `UPLOAD_KEYSTORE_PATH`
em `.env.local-build`, fora do repositório) é a chave de assinatura de upload
usada pra publicar o app Android na Play Store. **Perder esse arquivo exige um
processo de recuperação pelo Google que leva DIAS e bloqueia todo envio nesse
meio tempo** — isso já aconteceu uma vez neste projeto (chave original perdida
num `expo prebuild --clean` por volta de 10/09/2026, recuperada só em
17-19/10/2026 via "Solicitar redefinição da chave de upload" no Play Console).

Regras:
- **NUNCA** rode `keytool -genkeypair` apontando pra esse caminho, nem apague
  o arquivo, a menos que o usuário peça EXPLICITAMENTE pra gerar uma chave
  nova (ex: depois de um reset de verdade aprovado pelo Google).
- **NUNCA** apague ou regenere a pasta `C:/Android/keystore/` inteira.
- Antes de qualquer `expo prebuild --clean` ou de apagar a pasta `android/`
  (ela é gitignorada e descartável de propósito), confirme que o keystore de
  upload mora FORA dela (em `C:/Android/keystore/`, não em `android/app/`) -
  é assim que ele sobrevive ao prebuild. Veja `scripts/patch-android-build.js`
  e `scripts/build-android-local.sh`, que reaplicam essa config local toda
  vez que a pasta `android/` é regenerada.
- Se o arquivo sumir ou o fingerprint não bater com o que a Play Store
  espera, PARE e avise o usuário antes de gerar qualquer chave nova - isso
  dispara o processo de recuperação de dias, não é reversível com um
  `git checkout`.
