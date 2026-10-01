// Learn more https://docs.expo.dev/router/reference/static-rendering/#root-html

import { ScrollViewStyleReset, useServerDocumentContext } from 'expo-router/html';

// This file is web-only and used to configure the root HTML for every
// web page during static rendering.
// The contents of this function only run in Node.js environments and
// do not have access to the DOM or browser APIs.
export default function Root({ children }: { children: React.ReactNode }) {
  // This is only required for server-side rendering.
  const { bodyAttributes, bodyNodes, htmlAttributes, headNodes } = useServerDocumentContext();

  return (
    // O template padrão do Expo deixa lang="en" fixo - com conteúdo em
    // português, isso faz o Chrome (principalmente Android) ativar a
    // tradução automática da página, que troca o texto de elementos curtos
    // isolados (tipo o label "Início" da aba) por traduções sem sentido tipo
    // "Não se trata de uma questão de..." - reportado ao vivo num celular
    // real. lang="pt-BR" certo + notranslate evita o Chrome tentar traduzir
    // a UI do app.
    <html lang="pt-BR" {...htmlAttributes}>
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no" />
        <meta name="google" content="notranslate" />

        {/*
          Disable body scrolling on web. This makes ScrollView components work closer to how they do on native.
          However, body scrolling is often nice to have for mobile web. If you want to enable it, remove this line.
        */}
        <ScrollViewStyleReset />

        {headNodes}

        {/* Add any additional <head> elements that you want globally available on web... */}
      </head>
      <body className="notranslate" translate="no" {...bodyAttributes}>
        {children}
        {bodyNodes}
      </body>
    </html>
  );
}
