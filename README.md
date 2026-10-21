# Synquei

**Sincronia de câmeras, celulares e gravadores pelo som, direto no navegador.** Solta as pastas dos cartões, o Synquei reconhece cada arquivo, separa por aparelho, acha onde cada clipe entra e exporta o projeto para o seu editor.

- **Site:** [synquei.vercel.app](https://synquei.vercel.app) · **App:** [/app/](https://synquei.vercel.app/app/) · **Formatos:** [/formatos/](https://synquei.vercel.app/formatos/)
- Sem build e sem dependências: HTML, CSS e módulos ES. É só servir a pasta.
- Nada sai do computador: os arquivos são lidos direto do disco pelo navegador.

---

## O app

| Aba | O que tem |
| --- | --- |
| **Início** | Painel do projeto aberto: sincronia, confiança, material por aparelho, atalhos, dicas do tipo de projeto, recentes |
| **Projetos** | Novo projeto com tipo, projetos separados por tipo (filtro e seções), soltar pastas, exemplo, `.synquei` |
| **Mídia** | Clipes agrupados por aparelho (renomear, trocar o tipo, mover clipe), filtros, busca, todos os metadados de cada arquivo, arquivos ignorados |
| **Sincronizar** | Método (som + timecode, só som, só timecode), timecode batido, data, ordem, deriva, rigor, sessões; andamento ao vivo e resultado |
| **Linha do tempo** | Agulha com timecode (arrastar pela régua, setas, Home/End), monitor com a câmera em grande e os outros ângulos, play com o som do gravador (espaço), tela cheia (F); uma faixa por aparelho, cor por confiança, arrastar para ajustar, empurrar por quadro ou milissegundo, formas de onda sobrepostas |
| **Exportar** | Premiere, Resolve, Final Cut, Avid, Vegas/Lightworks, OTIO, EDL, relatório; pasta da mídia, fps, resolução, TC de início, áudio da câmera, canais do gravador; tudo num `.zip` |
| **Formatos** | Catálogo pesquisável do que é reconhecido |
| **Ajustes** | Tema, padrões, atalhos, privacidade, dados |

Visual claro com modo escuro automático; palcos e linha do tempo sempre escuros.

### Tipos de projeto (`app/js/tipos.js`)

Ao criar um projeto (pelo botão ou soltando as pastas), o Synquei pergunta o que está sendo gravado. Cada tipo ajusta a sincronia e a exportação e traz dicas de gravação; tudo continua editável.

| Grupo | Tipos |
| --- | --- |
| Música | Videoclipe (takes sobre a música, sem ordem por aparelho, só som), Show ao vivo, DVD · Gravação ao vivo, EP · Sessão ao vivo |
| Conversa e documentário | Entrevista, Podcast · Videocast, Documentário |
| Conteúdo e ensino | Vídeo de conteúdo, Aula · Curso online |
| Eventos | Casamento, Evento · Palestra, Culto · Celebração |
| Ficção e publicidade | Curta · Filme · Série, Publicidade |
| Outros | Teatro · Dança, Esporte · Ação, Outro |

**Multicâmera** liga ou desliga por projeto (vem do tipo): Premiere recebe a sequência de ângulos aninhada numa sequência de edição (clique com o direito › Multicâmera › Ativar), Resolve 18+ e Final Cut recebem clipe multicâmera em FCPXML, Avid agrupa em multigroup pelo Auxiliary TC1.

## Como sincroniza (`app/js/sync/engine.js`)

1. **Áudio leve:** o som de cada clipe é lido direto do arquivo (só os bytes de áudio) e vira um sinal mono de 4 kHz.
2. **Ataques:** cada sinal vira uma curva de "onde o som começa" a 100 Hz (palavras, palmas, batidas), ponderada pelo volume.
3. **Âncora e trilha composta:** o clipe mais longo é a âncora. Os já posicionados formam uma trilha composta; cada clipe pendente é comparado com ela por correlação cruzada (FFT por blocos). Quem tem mais confiança entra primeiro, a trilha cresce e a rodada seguinte acha quem só se sobrepõe aos recém-chegados (uma câmera que só pega outra câmera).
4. **Ajuste fino:** o pico é refinado na forma de onda contra o clipe vizinho de maior sobreposição, com interpolação parabólica (precisão abaixo de 1 ms nos testes).
5. **Deriva:** em clipes com mais de 2,5 min de sobreposição, mede começo e fim; se o relógio deriva, registra em ppm e alinha pelo meio.
6. **Ilhas:** grupos sem som em comum com o resto são sincronizados entre si e encaixados pelo timecode (ou pela data) de um aparelho presente nos dois grupos. Sem isso, viram uma sessão à parte.
7. **Reservas:** clipe sem áudio entra pelo par (CinemaDNG/ARRIRAW + WAV da pasta, Panasonic P2 VIDEO/AUDIO), pelo timecode ou pela data do arquivo do mesmo aparelho.
8. **Sessões:** intervalos maiores que o escolhido (20 min por padrão) separam sequências.

Timecode e data são **pista**, não decisão: estreitam a busca e encaixam o que não tem som.

## Reconhecimento de arquivos (`app/js/media/`)

O tipo é decidido pelos **primeiros bytes** (`probe.js`), não pela extensão. Leitores próprios, sem bibliotecas:

| Leitor | Formatos | O que extrai |
| --- | --- | --- |
| `mp4.js` | MOV, MP4, M4A, BRAW, CRM, NEV, INSV | codec (fourcc), tamanho, fps, faixa de timecode (`tmcd`), data, fabricante/modelo, XML da Sony embutido, edit list (priming do AAC), plano de áudio PCM/AAC |
| `mxf.js` | MXF OP1a e OP-Atom | descritores (codec por UL, tamanho, edit rate, duração), componente de timecode, identificação, áudio BWF/AES3 (inclusive D-10) |
| `riff.js` | WAV, BWF, RF64/BW64, Wave64, AIFF/AIFC, AVI/OpenDML | formato, `bext` (TimeReference → timecode, Originator → gravador), `iXML` (cena, take, fita, nomes das trilhas, taxa de TC), PCM do AVI |
| `ebml.js` | MKV, WebM | duração, data, faixas, codecs |
| `ts.js` | MTS/M2TS (AVCHD), TS | PAT/PMT, codecs, duração pelo PTS, áudio LPCM e AAC |
| `raw.js` | DNG/TIFF, R3D, Cine | timecode e frame rate do CinemaDNG, cabeçalho RED1 |
| `sidecar.js` | XML da Sony (`C0001M01.XML`), iXML | timecode (LtcChangeTable), modelo e série, cena/take |
| `scan.js` | — | ignora sombras do macOS, miniaturas, proxies e metadados; junta sequências de quadros e partes de R3D num clipe |
| `devices.js` | — | grupos por pasta do usuário, modelo/série, estrutura do cartão, letra de câmera (A001C001), padrão do nome |

O catálogo completo (contêineres, RAW, codecs, estruturas de cartão) está em `app/js/media/formats.js`, e é a mesma tabela que a página `/formatos/` mostra.

**Limites do navegador, ditos com franqueza:** AAC, Opus e outros comprimidos dependem do decodificador do navegador (Chrome e Edge resolvem quase tudo; o AAC usa WebCodecs). AC-3 dentro de AVCHD não é decodificado: esses clipes entram pelo timecode/data ou pelo áudio do gravador. RAW sem áudio legível (R3D, ARRIRAW, sequências) entra pelo timecode, pela data ou pelo WAV da pasta.

## Exportações (`app/js/export/`)

| Destino | Arquivo | Detalhes |
| --- | --- | --- |
| Premiere Pro | XML do Final Cut 7 (xmeml v4) | uma sequência por sessão dentro de um projeto (multicâmera: ângulos aninhados numa sequência de edição), vídeo e áudio vinculados, cor por aparelho, marcadores nos clipes para conferir |
| DaVinci Resolve | xmeml por sessão + OTIO (+ FCPXML multicâmera) | importa como timeline; multicâmera pelo .fcpxml no Resolve 18+ |
| Final Cut Pro | FCPXML 1.10 | projeto em camadas + clipe multicâmera (um ângulo por aparelho); áudio sem vídeo com precisão de amostra (início no quadro, ajuste no corte de entrada) |
| Avid Media Composer | ALE + EDL | tempo sincronizado no Auxiliary TC1 para agrupar |
| Vegas Pro, Lightworks | xmeml por sessão | |
| OpenTimelineIO | `.otio` por sessão | áudio a 48 kHz |
| EDL | CMX 3600, uma por faixa | |
| Relatório | CSV + `.synquei` | o `.synquei` reabre o projeto |

O caminho dos arquivos sai da **pasta da mídia** que você informa + o caminho relativo da pasta arrastada (o navegador não revela caminhos absolutos). No app de desktop (Electron), o caminho absoluto é usado direto.

## App de desktop (Mac e Windows)

O mesmo app, empacotado com Electron (`desktop/main.cjs`). Vantagens sobre o navegador:

- **Caminho completo** de cada arquivo vai para as exportações: o editor acha a mídia sem revincular (a pasta da mídia nem aparece).
- **AAC e H.264 sempre**: o Chromium do Electron traz os decodificadores (áudio de celular e GoPro, miniaturas).
- Menu em português, atalhos (⌘N, ⌘O, ⌘1–6), janela integrada à barra lateral no Mac.
- **Atualiza sozinho** (`desktop/atualizador.cjs`, mesmo esquema do SOBEDESCE): confere `/baixar/versao` ao abrir e a cada hora, baixa o instalador do build novo em segundo plano, confere o SHA-256 e mostra "Atualizar agora" na barra lateral; um script espera o app fechar, troca (Mac: `.dmg` montado e `ditto`; Windows: NSIS em silêncio) e abre de novo. Se a troca falhar, o app antigo volta e o aviso oferece o Baixar. O build do app vem de `desktop/build-info.json`, gravado pelo CI (`node scripts/release.mjs build-info`).

Distribuição (mesmo modelo do SOBEDESCE):

1. `.github/workflows/desktop.yml` gera o `.dmg` (universal, Apple Silicon e Intel) num Mac e o `.exe` (x64 e ARM) num Windows do GitHub, roda o teste de fumaça do app empacotado (`--smoke`: monta o exemplo, sincroniza, exporta) e publica no Release **"Synquei · app de desktop"** (tag `app-desktop`), com o build no nome e um `versao.json` com o SHA-256 de cada instalador.
2. `api/baixar.js` (função da Vercel) atende `/baixar/mac`, `/baixar/windows` e `/baixar/versao` e manda direto para o arquivo do GitHub. **Repositório privado:** crie na Vercel a variável `GITHUB_TOKEN` (token fino, só leitura de *Contents* deste repositório).
3. `instalar.sh` e `instalar.ps1`: instalação de uma linha, sem os avisos do macOS/Windows, conferindo o SHA-256:
   - Mac: `curl -fsSL https://synquei.vercel.app/instalar.sh | bash`
   - Windows: `irm https://synquei.vercel.app/instalar.ps1 | iex`

Sem assinatura da Apple/Microsoft por enquanto (ad-hoc no Mac). O site ensina a abrir na primeira vez.

```sh
npm install
npm run desktop          # abre o app de desktop
npm run smoke            # teste de fumaça
npm run dist:mac         # .dmg (num Mac)
npm run dist:win         # .exe (no Windows)
```

## Rodar local

```sh
npx http-server -p 8080 -c-1 .   # abra http://localhost:8080/app/
npm test                          # motor + ponta a ponta com arquivos gerados no ffmpeg
```

Os testes geram uma cena falada sintética, "gravam" com microfones diferentes (ganho, filtro, eco, ruído, relógio com deriva) e conferem: sincronia com erro abaixo de 1 ms, deriva medida, clipe de outra cena rejeitado, ilha encaixada pela data. O teste de ponta a ponta monta uma pasta de projeto real (ProRes com TC, MP4 Sony com XML ao lado, MXF XDCAM, BWF com iXML, lixo do macOS), passa por todo o fluxo e valida as exportações no `xmllint` e o `.zip` no `unzip`.

## Estrutura

```
index.html, site.css, site.js   site (palco animado, demos, exportação, comparativo)
formatos/                       catálogo de formatos
app/                            o app (index.html, app.css, js/)
  js/media/                     leitores de arquivo, catálogo, agrupamento
  js/sync/                      motor (FFT, correlação, deriva), worker, cena sintética
  js/export/                    xmeml, FCPXML, OTIO, EDL, ALE, CSV, ZIP
  js/views/                     uma tela por aba
sw.js                           modo offline
desktop/                        app de desktop (Electron)
api/baixar.js                   /baixar/* na Vercel
instalar.sh, instalar.ps1       instalação de uma linha
.github/workflows/desktop.yml   instaladores no GitHub Actions
tests/                          node --test
```
