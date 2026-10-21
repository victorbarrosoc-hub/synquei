// Catálogo de formatos do Synquei: contêineres, RAW de câmera, codecs, estruturas de cartão e o que é ignorado.
// É a mesma tabela que o detector usa e que a página /formatos/ mostra, então o site nunca promete o que o app não faz.
//
// audio: o que o Synquei faz com o som do arquivo
//   'full'     lê e sincroniza no navegador, em qualquer navegador moderno
//   'codec'    depende do decodificador do navegador (AAC, Opus, AC-3…): Chrome e Edge resolvem quase tudo
//   'external' não tem áudio legível (RAW): entra pelo timecode, pela data ou pelo WAV que a câmera grava junto
//   'none'     arquivo sem som

export const CONTAINERS = [
  // ───────── vídeo ─────────
  { id: 'mov', name: 'QuickTime', ext: ['mov', 'qt'], kind: 'video', audio: 'full', tc: true, who: 'ARRI, Blackmagic, Atomos, iPhone, Canon, Nikon, Fujifilm, Panasonic, DJI', note: 'ProRes, H.264, HEVC, DNxHR, CineForm. Áudio PCM lido direto; AAC pelo navegador.' },
  { id: 'mp4', name: 'MPEG-4 (ISO BMFF)', ext: ['mp4', 'm4v'], kind: 'video', audio: 'full', tc: true, who: 'Sony XAVC S/HS, GoPro, DJI, Canon, Panasonic, celulares', note: 'XAVC S grava PCM (lido direto); celulares e GoPro gravam AAC.' },
  { id: 'mxf', name: 'MXF', ext: ['mxf'], kind: 'video', audio: 'full', tc: true, who: 'Sony FX6/FX9/Venice, Canon C70/C300/C500, Panasonic P2/VariCam, ARRI ALEXA 35, Avid', note: 'OP1a e OP-Atom. Áudio BWF e AES3 lido direto; timecode do pacote.' },
  { id: 'mts', name: 'AVCHD / MPEG-TS', ext: ['mts', 'm2ts', 'ts', 'm2t', 'tod', 'mod'], kind: 'video', audio: 'codec', tc: false, who: 'Sony e Panasonic (AVCHD), HDV, gravadores de broadcast', note: 'LPCM e AAC lidos; AC-3 depende do navegador.' },
  { id: 'avi', name: 'AVI / OpenDML', ext: ['avi'], kind: 'video', audio: 'full', tc: false, who: 'Câmeras antigas, DV, MJPEG, capturas', note: 'Áudio PCM lido direto, inclusive acima de 1 GB (AVIX).' },
  { id: 'mkv', name: 'Matroska / WebM', ext: ['mkv', 'webm', 'mka'], kind: 'video', audio: 'codec', tc: false, who: 'OBS, gravações de tela, ferramentas abertas', note: 'Opus, Vorbis, AAC e FLAC pelo navegador.' },
  { id: 'insv', name: 'Insta360 / GoPro 360', ext: ['insv', '360', 'lrv'], kind: 'video', audio: 'codec', tc: false, who: 'Insta360, GoPro MAX', note: 'MP4 por dentro. O LRV (proxy da GoPro) fica de fora automaticamente.' },
  { id: 'mpg', name: 'MPEG-PS', ext: ['mpg', 'mpeg', 'vob', 'm2p'], kind: 'video', audio: 'codec', tc: false, who: 'DVD, câmeras SD antigas', note: 'Reconhecido; o áudio MPEG/AC-3 depende do navegador.' },
  { id: 'asf', name: 'Windows Media', ext: ['wmv', 'asf'], kind: 'video', audio: 'codec', tc: false, who: 'Arquivos antigos do Windows', note: 'Reconhecido; o som depende do navegador.' },
  { id: 'flv', name: 'Flash Video', ext: ['flv', 'f4v'], kind: 'video', audio: 'codec', tc: false, who: 'Gravações antigas de transmissão', note: 'Reconhecido; o som depende do navegador.' },
  { id: '3gp', name: '3GPP', ext: ['3gp', '3g2'], kind: 'video', audio: 'codec', tc: false, who: 'Celulares antigos', note: 'MP4 por dentro.' },
  { id: 'dv', name: 'DV bruto', ext: ['dv', 'dif'], kind: 'video', audio: 'codec', tc: true, who: 'Fitas MiniDV, DVCAM, DVCPRO', note: 'Reconhecido pela extensão.' },

  // ───────── áudio ─────────
  { id: 'wav', name: 'WAV / Broadcast WAV', ext: ['wav', 'bwf', 'wave'], kind: 'audio', audio: 'full', tc: true, who: 'Zoom, Tascam, Sound Devices, Rode, DJI Mic, Deity, Sennheiser', note: 'PCM 8 a 32 bits e 32 bits float. Lê bext (timecode), iXML (cena, take, nomes das trilhas).' },
  { id: 'rf64', name: 'RF64 / BW64', ext: ['wav', 'rf64'], kind: 'audio', audio: 'full', tc: true, who: 'Gravações acima de 4 GB (Sound Devices, Zoom F8n, Nagra)', note: 'Mesmo WAV, com tamanho de 64 bits.' },
  { id: 'w64', name: 'Sony Wave64', ext: ['w64'], kind: 'audio', audio: 'full', tc: false, who: 'Sound Forge, Vegas', note: 'WAV de 64 bits da Sony.' },
  { id: 'aiff', name: 'AIFF / AIFF-C', ext: ['aif', 'aiff', 'aifc'], kind: 'audio', audio: 'full', tc: false, who: 'Logic, Pro Tools, macOS', note: 'PCM big-endian, sowt e float.' },
  { id: 'caf', name: 'Core Audio Format', ext: ['caf'], kind: 'audio', audio: 'codec', tc: false, who: 'Apple', note: 'Pelo decodificador do navegador.' },
  { id: 'mp3', name: 'MP3', ext: ['mp3'], kind: 'audio', audio: 'codec', tc: false, who: 'Gravadores de bolso, celulares', note: 'Todo navegador decodifica.' },
  { id: 'm4a', name: 'MPEG-4 Áudio', ext: ['m4a', 'm4b', 'aac'], kind: 'audio', audio: 'codec', tc: false, who: 'Gravador do iPhone, apps de celular', note: 'AAC e ALAC.' },
  { id: 'flac', name: 'FLAC', ext: ['flac'], kind: 'audio', audio: 'codec', tc: false, who: 'Arquivos sem perda', note: 'Todo navegador moderno decodifica.' },
  { id: 'ogg', name: 'Ogg / Opus', ext: ['ogg', 'oga', 'opus'], kind: 'audio', audio: 'codec', tc: false, who: 'Gravações de chamada, apps', note: 'Vorbis e Opus.' },
  { id: 'wma', name: 'Windows Media Áudio', ext: ['wma'], kind: 'audio', audio: 'codec', tc: false, who: 'Arquivos antigos', note: 'Depende do navegador.' },
  { id: 'ac3', name: 'Dolby Digital / DTS', ext: ['ac3', 'eac3', 'ec3', 'dts'], kind: 'audio', audio: 'codec', tc: false, who: 'Masters de entrega', note: 'Depende do navegador.' },
  { id: 'amr', name: 'AMR', ext: ['amr', '3ga'], kind: 'audio', audio: 'codec', tc: false, who: 'Gravações de voz de celular', note: 'Depende do navegador.' },
  { id: 'au', name: 'Sun AU', ext: ['au', 'snd'], kind: 'audio', audio: 'codec', tc: false, who: 'Sistemas Unix', note: 'Depende do navegador.' },
]

// RAW de câmera. O vídeo não é decodificado no navegador (nem precisa: o editor faz isso). O Synquei usa o timecode, a
// data, a estrutura do cartão e o WAV que a câmera grava junto para colocar o clipe no lugar certo.
export const RAW = [
  { id: 'r3d', name: 'REDCODE RAW', ext: ['r3d'], brand: 'RED', who: 'V-RAPTOR, KOMODO, DSMC2, MONSTRO', audio: 'external', note: 'Clipe em pedaços (_001.R3D, _002.R3D…) dentro da pasta .RDC: o Synquei junta os pedaços num clipe só.' },
  { id: 'braw', name: 'Blackmagic RAW', ext: ['braw'], brand: 'Blackmagic', who: 'Pocket 4K/6K, URSA, Cinema Camera 6K, PYXIS', audio: 'full', note: 'Por dentro é QuickTime: o áudio PCM e o timecode são lidos direto.' },
  { id: 'prores-raw', name: 'Apple ProRes RAW', ext: ['mov'], brand: 'Apple', who: 'Atomos Ninja, DJI Inspire/Ronin 4D, Nikon Z, Panasonic S1H', audio: 'full', note: 'É um MOV comum: áudio e timecode lidos direto.' },
  { id: 'arriraw', name: 'ARRIRAW', ext: ['ari', 'arx', 'mxf'], brand: 'ARRI', who: 'ALEXA 35, Mini LF, LF, 65', audio: 'external', note: 'Sequência .ari/.arx vira um clipe só; no ALEXA 35 o ARRIRAW vem em MXF.' },
  { id: 'xocn', name: 'Sony X-OCN / RAW', ext: ['mxf'], brand: 'Sony', who: 'VENICE, BURANO, FX9 + XDCA', audio: 'full', note: 'MXF com áudio PCM e timecode.' },
  { id: 'crm', name: 'Canon Cinema RAW Light', ext: ['crm'], brand: 'Canon', who: 'C70, C200, C300 III, C500 II, R5 C, R5', audio: 'full', note: 'Contêiner da família QuickTime: áudio PCM e timecode quando presentes.' },
  { id: 'nraw', name: 'Nikon N-RAW', ext: ['nev'], brand: 'Nikon', who: 'Z9, Z8, Z6III, ZR', audio: 'full', note: 'Contêiner ISO: o áudio PCM é lido quando a câmera grava junto.' },
  { id: 'cdng', name: 'CinemaDNG', ext: ['dng'], brand: 'Vários', who: 'Blackmagic (antigas), DJI X7, Sigma fp, Kinefinity', audio: 'external', note: 'Sequência de quadros vira um clipe; o WAV da mesma pasta vira o áudio do clipe. Lê timecode e frame rate do DNG.' },
  { id: 'zraw', name: 'Z CAM ZRAW', ext: ['zraw', 'mov'], brand: 'Z CAM', who: 'E2, E2-F6, E2-F8', audio: 'full', note: 'MOV por dentro.' },
  { id: 'cine', name: 'Phantom Cine', ext: ['cine'], brand: 'Vision Research', who: 'Phantom Flex, VEO, TMX', audio: 'none', note: 'Alta velocidade, sem áudio: entra pela data.' },
  { id: 'mcraw', name: 'MotionCam RAW', ext: ['mcraw'], brand: 'MotionCam', who: 'Celulares Android', audio: 'external', note: 'Reconhecido; use o áudio do celular ou do gravador.' },
  { id: 'seq', name: 'Sequências DPX / EXR / TIFF', ext: ['dpx', 'exr', 'tif', 'tiff', 'cin'], brand: 'VFX', who: 'Pós, scanners, efeitos', audio: 'none', note: 'Quadros numerados viram um clipe; sem áudio.' },
]

// Codecs de vídeo por código de quatro letras (MOV/MP4) ou equivalente.
export const VIDEO_CODECS = [
  { fourcc: ['apch'], name: 'Apple ProRes 422 HQ', family: 'ProRes' },
  { fourcc: ['apcn'], name: 'Apple ProRes 422', family: 'ProRes' },
  { fourcc: ['apcs'], name: 'Apple ProRes 422 LT', family: 'ProRes' },
  { fourcc: ['apco'], name: 'Apple ProRes 422 Proxy', family: 'ProRes' },
  { fourcc: ['ap4h'], name: 'Apple ProRes 4444', family: 'ProRes' },
  { fourcc: ['ap4x'], name: 'Apple ProRes 4444 XQ', family: 'ProRes' },
  { fourcc: ['aprn'], name: 'Apple ProRes RAW', family: 'ProRes RAW', raw: true },
  { fourcc: ['aprh'], name: 'Apple ProRes RAW HQ', family: 'ProRes RAW', raw: true },
  { fourcc: ['avc1', 'avc3', 'H264', 'h264', 'x264', 'AVC1'], name: 'H.264 / AVC', family: 'H.264' },
  { fourcc: ['hvc1', 'hev1', 'HEVC', 'hevc', 'H265'], name: 'H.265 / HEVC', family: 'HEVC' },
  { fourcc: ['dvh1', 'dvhe', 'dvav', 'dva1'], name: 'Dolby Vision', family: 'HEVC' },
  { fourcc: ['av01'], name: 'AV1', family: 'AV1' },
  { fourcc: ['vp09', 'VP90'], name: 'VP9', family: 'VP9' },
  { fourcc: ['vp08', 'VP80'], name: 'VP8', family: 'VP8' },
  { fourcc: ['vvc1', 'vvi1'], name: 'H.266 / VVC', family: 'VVC' },
  { fourcc: ['AVdn'], name: 'Avid DNxHD', family: 'DNx' },
  { fourcc: ['AVdh'], name: 'Avid DNxHR', family: 'DNx' },
  { fourcc: ['AVd1', 'AVdv'], name: 'Avid DV / AVR', family: 'DNx' },
  { fourcc: ['CFHD'], name: 'GoPro CineForm', family: 'CineForm' },
  { fourcc: ['ai5p', 'ai5q', 'ai52', 'ai53', 'ai55', 'ai56', 'ai1p', 'ai1q', 'ai12', 'ai13', 'ai15', 'ai16', 'aivx', 'AVin'], name: 'Panasonic AVC-Intra', family: 'H.264' },
  { fourcc: ['xdv1', 'xdv2', 'xdv3', 'xdv4', 'xdv5', 'xdv6', 'xdv7', 'xdv8', 'xdv9', 'xdva', 'xdvb', 'xdvc', 'xdvd', 'xdve', 'xdvf', 'xd54', 'xd55', 'xd59', 'xd5a', 'xd5b', 'xd5c', 'xd5d', 'xd5e', 'xd5f', 'xdhd', 'xdh2'], name: 'Sony XDCAM (MPEG-2)', family: 'MPEG-2' },
  { fourcc: ['mx3p', 'mx4p', 'mx5p', 'mx3n', 'mx4n', 'mx5n'], name: 'Sony IMX / D-10', family: 'MPEG-2' },
  { fourcc: ['mp2v', 'mpg2', 'hdv1', 'hdv2', 'hdv3', 'hdv4', 'hdv5', 'hdv6', 'hdv7', 'hdv8', 'hdv9', 'hdva'], name: 'MPEG-2 / HDV', family: 'MPEG-2' },
  { fourcc: ['mp4v', 'XVID', 'DIVX', 'DX50', 'FMP4'], name: 'MPEG-4 Part 2', family: 'MPEG-4' },
  { fourcc: ['dvc ', 'dvcp', 'dvpp', 'dv5n', 'dv5p', 'dvh2', 'dvh3', 'dvh5', 'dvh6', 'dvhp', 'dvhq', 'dvsd', 'dv25', 'dv50', 'cdvc', 'CDVC'], name: 'DV / DVCPRO', family: 'DV' },
  { fourcc: ['mjpa', 'mjpb', 'jpeg', 'MJPG', 'mjpg', 'AVDJ', 'dmb1'], name: 'Motion JPEG', family: 'JPEG' },
  { fourcc: ['mjp2', 'MJ2C'], name: 'JPEG 2000', family: 'JPEG 2000' },
  { fourcc: ['icod', 'icdn'], name: 'Apple Intermediate', family: 'Apple' },
  { fourcc: ['rle '], name: 'QuickTime Animation', family: 'Apple' },
  { fourcc: ['png '], name: 'PNG', family: 'Imagem' },
  { fourcc: ['v210', '2vuy', 'yuv2', 'v308', 'v408', 'v410', 'r210', 'R10k', 'b64a', 'raw ', 'UYVY', 'YUY2'], name: 'Não comprimido', family: 'Não comprimido' },
  { fourcc: ['Hap1', 'Hap5', 'HapY', 'HapM', 'HapA'], name: 'HAP', family: 'HAP' },
  { fourcc: ['brxq', 'brst', 'brvn', 'brs2', 'brlt', 'brhq', 'brbq'], name: 'Blackmagic RAW', family: 'Blackmagic RAW', raw: true },
  { fourcc: ['CRAW', 'craw', 'crx '], name: 'Canon Cinema RAW Light', family: 'Canon RAW', raw: true },
  { fourcc: ['zraw', 'ZRAW'], name: 'Z CAM ZRAW', family: 'ZRAW', raw: true },
  { fourcc: ['tscc', 'tsc2'], name: 'TechSmith Screen', family: 'Tela' },
]

export const AUDIO_CODECS = [
  { fourcc: ['lpcm', 'sowt', 'twos', 'in24', 'in32', 'fl32', 'fl64', 'raw ', 'ipcm', 'fpcm', 'NONE'], name: 'PCM', support: 'full' },
  { fourcc: ['mp4a'], name: 'AAC', support: 'codec' },
  { fourcc: ['alac'], name: 'Apple Lossless', support: 'codec' },
  { fourcc: ['ac-3', 'sac3'], name: 'Dolby Digital (AC-3)', support: 'codec' },
  { fourcc: ['ec-3'], name: 'Dolby Digital Plus', support: 'codec' },
  { fourcc: ['Opus', 'opus'], name: 'Opus', support: 'codec' },
  { fourcc: ['fLaC'], name: 'FLAC', support: 'codec' },
  { fourcc: ['.mp3', 'mp3 ', 'ms\u0000U'], name: 'MP3', support: 'codec' },
  { fourcc: ['ulaw', 'alaw'], name: 'G.711', support: 'codec' },
  { fourcc: ['samr', 'sawb'], name: 'AMR', support: 'codec' },
  { fourcc: ['ima4'], name: 'IMA ADPCM', support: 'codec' },
  { fourcc: ['dtsc', 'dtsh', 'dtsl'], name: 'DTS', support: 'codec' },
  { fourcc: ['mlpa'], name: 'Dolby TrueHD', support: 'codec' },
]

// Formato de cada amostra no chunk "fmt " do WAV (wFormatTag).
export const WAV_FORMAT_TAGS = {
  0x0001: 'PCM',
  0x0003: 'PCM 32 bits float',
  0x0006: 'A-law',
  0x0007: 'µ-law',
  0x0011: 'IMA ADPCM',
  0x0050: 'MPEG',
  0x0055: 'MP3',
  0x00ff: 'AAC',
  0x2000: 'AC-3',
  0xfffe: 'Extensível',
}

// Estruturas de cartão: o caminho conta qual câmera gravou, antes mesmo de abrir o arquivo.
export const CARD_LAYOUTS = [
  { re: /PRIVATE\/M4ROOT\/CLIP\//i, brand: 'Sony', kind: 'camera', label: 'Sony XAVC S / HS', example: 'PRIVATE/M4ROOT/CLIP/C0001.MP4' },
  { re: /XDROOT\/Clip\//i, brand: 'Sony', kind: 'camera', label: 'Sony XDCAM / XAVC', example: 'XDROOT/Clip/A001C001_230501AB.MXF' },
  { re: /PRIVATE\/AVCHD\/BDMV\/STREAM\//i, brand: 'AVCHD', kind: 'camera', label: 'AVCHD (Sony, Panasonic)', example: 'PRIVATE/AVCHD/BDMV/STREAM/00000.MTS' },
  { re: /DCIM\/\d{3}GOPRO\//i, brand: 'GoPro', kind: 'action', label: 'GoPro', example: 'DCIM/100GOPRO/GX010231.MP4' },
  { re: /DCIM\/(DJI_\d+|\d{3}MEDIA)\//i, brand: 'DJI', kind: 'drone', label: 'DJI', example: 'DCIM/DJI_001/DJI_20240501142210_0001_D.MP4' },
  { re: /DCIM\/\d{3}CANON\//i, brand: 'Canon', kind: 'camera', label: 'Canon EOS', example: 'DCIM/100CANON/MVI_0001.MP4' },
  { re: /DCIM\/\d{3}NIKON\/|DCIM\/\d{3}NCZ_/i, brand: 'Nikon', kind: 'camera', label: 'Nikon', example: 'DCIM/100NIKON/DSC_0001.MOV' },
  { re: /DCIM\/\d{3}_FUJI\//i, brand: 'Fujifilm', kind: 'camera', label: 'Fujifilm', example: 'DCIM/100_FUJI/DSCF0001.MOV' },
  { re: /DCIM\/\d{3}_PANA\//i, brand: 'Panasonic', kind: 'camera', label: 'Panasonic Lumix', example: 'DCIM/100_PANA/P1000001.MOV' },
  { re: /DCIM\/\d{3}OLYMP\/|DCIM\/\d{3}OMSYS\//i, brand: 'OM System', kind: 'camera', label: 'OM System / Olympus', example: 'DCIM/100OMSYS/P5010001.MOV' },
  { re: /DCIM\/Camera01\/|DCIM\/\d{3}INSTA/i, brand: 'Insta360', kind: 'action', label: 'Insta360', example: 'DCIM/Camera01/VID_20240501_142210_00_001.insv' },
  { re: /CONTENTS\/CLIPS\d{3}\//i, brand: 'Canon', kind: 'camera', label: 'Canon Cinema EOS (XF-AVC)', example: 'CONTENTS/CLIPS001/A001C001_240501AB_CANON.MXF' },
  { re: /CONTENTS\/(VIDEO|AUDIO)\//i, brand: 'Panasonic', kind: 'camera', label: 'Panasonic P2', example: 'CONTENTS/VIDEO/0001AB.MXF' },
  { re: /\.RDC\//i, brand: 'RED', kind: 'camera', label: 'RED', example: 'A001_C001_0501AB.RDC/A001_C001_0501AB_001.R3D' },
  { re: /\.RDM\//i, brand: 'RED', kind: 'camera', label: 'RED (magazine)', example: 'A001_0501AB.RDM/…' },
  { re: /ZOOM\d{4}\//i, brand: 'Zoom', kind: 'recorder', label: 'Zoom (pasta do take)', example: 'FOLDER01/ZOOM0001/ZOOM0001_LR.WAV' },
]

// Nome do arquivo → aparelho provável. A ordem importa: o primeiro que bater ganha.
export const NAME_PATTERNS = [
  { re: /^GX\d{6}\.MP4$|^GH\d{6}\.MP4$|^GOPR\d{4}\.MP4$|^GP\d{6}\.MP4$|^GS\d{6}\.360$/i, brand: 'GoPro', kind: 'action', label: 'GoPro' },
  { re: /^DJI_\d+/i, brand: 'DJI', kind: 'drone', label: 'DJI' },
  { re: /^C\d{4}(M01)?\.(MP4|MXF)$/i, brand: 'Sony', kind: 'camera', label: 'Sony' },
  { re: /^MAH\d{5}\.MP4$|^DSC\d{5}\.MP4$/i, brand: 'Sony', kind: 'camera', label: 'Sony (antiga)' },
  { re: /^MVI_\d{4}\.(MP4|MOV|AVI)$/i, brand: 'Canon', kind: 'camera', label: 'Canon EOS' },
  { re: /^DSC_\d{4}\.(MOV|MP4|NEV)$/i, brand: 'Nikon', kind: 'camera', label: 'Nikon' },
  { re: /^DSCF\d{4}\.(MOV|MP4)$/i, brand: 'Fujifilm', kind: 'camera', label: 'Fujifilm' },
  { re: /^P\d{7}\.(MOV|MP4)$/i, brand: 'Panasonic', kind: 'camera', label: 'Panasonic Lumix' },
  { re: /^IMG_\d{4}\.(MOV|MP4)$/i, brand: 'Apple', kind: 'phone', label: 'iPhone' },
  { re: /^VID_\d{8}_\d{6}/i, brand: 'Android', kind: 'phone', label: 'Celular / Insta360' },
  { re: /^PXL_\d{8}_\d+/i, brand: 'Google', kind: 'phone', label: 'Pixel' },
  { re: /^[A-Z]\d{3}_C\d{3}_[0-9A-Z]{6}(_\d{3})?\.R3D$/i, brand: 'RED', kind: 'camera', label: 'RED' },
  { re: /^[A-Z]\d{3}_\d{8}_C\d{3}\.braw$/i, brand: 'Blackmagic', kind: 'camera', label: 'Blackmagic' },
  { re: /^[A-Z]\d{3}C\d{3}_\d{6}_[0-9A-Z]{4}/i, brand: 'ARRI', kind: 'camera', label: 'ARRI' },
  { re: /^[A-Z]\d{3}C\d{3}_\d{6}[0-9A-Z]{2}_CANON/i, brand: 'Canon', kind: 'camera', label: 'Canon Cinema EOS' },
  { re: /^[A-Z]\d{3}C\d{3}_\d{6}[0-9A-Z]{2}/i, brand: 'Sony', kind: 'camera', label: 'Sony Cinema Line' },
  { re: /^ZOOM\d{4}/i, brand: 'Zoom', kind: 'recorder', label: 'Zoom' },
  { re: /^TASCAM_\d{4}/i, brand: 'Tascam', kind: 'recorder', label: 'Tascam' },
  { re: /^REC\d{5}\.WAV$/i, brand: 'Rode', kind: 'recorder', label: 'Rode Wireless' },
  { re: /^\d{6}_\d{3,4}\.WAV$|^\d{6}-\d{6}\.WAV$/i, brand: 'Sound Devices', kind: 'recorder', label: 'Sound Devices' },
  { re: /^[A-Z]?\d{3}[A-Z]?_?T\d{2,3}/i, brand: 'Gravador', kind: 'recorder', label: 'Gravador (cena/take)' },
  { re: /^Ninja|^Shogun|^ATOMOS/i, brand: 'Atomos', kind: 'camera', label: 'Atomos' },
]

// Arquivos que acompanham os cartões e não são mídia. Ficam de fora sem perguntar.
export const IGNORED = [
  { re: /(^|\/)\._/, why: 'Sombra do macOS (._arquivo) em cartão exFAT' },
  { re: /(^|\/)\.DS_Store$|(^|\/)Thumbs\.db$|(^|\/)desktop\.ini$/i, why: 'Arquivo do sistema' },
  { re: /\.(thm|lrv|bim|cpi|mpl|bdm|ind|smi|xmp|rmd|rtf|pdf|txt|log|ale|edl|fcpxml|xml|json|csv|cpf|ppn|sav|dat|bin|lut|cube|3dl|cdl|lnk|ini|cfg|html?)$/i, why: 'Metadado, miniatura, proxy ou documento' },
  { re: /\.(jpg|jpeg|heic|heif|png|gif|webp|arw|cr2|cr3|nef|raf|orf|rw2|psd)$/i, why: 'Foto' },
]

// O que cada apoio de sincronia significa, para mostrar ao lado do formato.
export const SUPPORT_LABEL = {
  full: 'Sincroniza pelo áudio',
  codec: 'Áudio pelo navegador',
  external: 'Timecode, data ou WAV junto',
  none: 'Sem áudio: timecode ou data',
}

const byExt = new Map()
for (const c of CONTAINERS) for (const e of c.ext) if (!byExt.has(e)) byExt.set(e, { kind: c.kind, id: c.id, name: c.name })
for (const r of RAW) for (const e of r.ext) if (!byExt.has(e)) byExt.set(e, { kind: r.id === 'seq' ? 'image' : 'video', id: r.id, name: r.name, raw: true })

/** Extensão → { kind, id, name, raw? } ou null. */
export function extInfo(ext) {
  return byExt.get(String(ext || '').toLowerCase()) || null
}

const vByFourcc = new Map()
for (const c of VIDEO_CODECS) for (const f of c.fourcc) vByFourcc.set(f, c)
const aByFourcc = new Map()
for (const c of AUDIO_CODECS) for (const f of c.fourcc) aByFourcc.set(f, c)

export function videoCodec(fourcc) {
  return vByFourcc.get(fourcc) || null
}
export function audioCodec(fourcc) {
  return aByFourcc.get(fourcc) || null
}

/** Por que um arquivo fica de fora (ou null se é mídia). */
export function ignoredReason(path) {
  for (const i of IGNORED) if (i.re.test(path)) return i.why
  return null
}

/** Quantos formatos o Synquei reconhece (contêineres + RAW + codecs), para o site. */
export function formatCount() {
  const exts = new Set()
  for (const c of CONTAINERS) c.ext.forEach((e) => exts.add(e))
  for (const r of RAW) r.ext.forEach((e) => exts.add(e))
  return { extensions: exts.size, videoCodecs: VIDEO_CODECS.length, audioCodecs: AUDIO_CODECS.length, raw: RAW.length, containers: CONTAINERS.length }
}
