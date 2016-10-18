import parseAnsi from '../util/ansi-parse';

const CLEAR_ANSI = /(?:\033)(?:\[0?c|\[[0356]n|\[7[lh]|\[\?25[lh]|\(B|H|\[(?:\d+(;\d+){,2})?G|\[(?:[12])?[JK]|[DM]|\[0K)/gm;
const CONTROL_CHARS = /\033\[1000D/gm;
const NORMALIZE_NEWLINES = /\r+\n/gm;
const NEWLINE = /^/gm;
const ENCODED_NEWLINE = 10;
const MIN_LINE_HEIGHT = 19;
const LINE_CHUNK = 1000;
const DECODER = new TextDecoder('utf-8');
// Setting a hard limit on lines since browser have trouble with heights starting at around 16.7 million pixels and up
const CHUNK_LIMIT = 883000 / LINE_CHUNK;
// HTML Escape helper utility
const util = (() => {
  // Thanks to Andrea Giammarchi
  const reEscape = /[&<>'"]/g;
  const reUnescape = /&(?:amp|#38|lt|#60|gt|#62|apos|#39|quot|#34);/g;
  const oEscape = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;'
  };
  const oUnescape = {
    '&amp;': '&',
    '&#38;': '&',
    '&lt;': '<',
    '&#60;': '<',
    '&gt;': '>',
    '&#62;': '>',
    '&apos;': "'",
    '&#39;': "'",
    '&quot;': '"',
    '&#34;': '"'
  };
  const fnEscape = (m) => oEscape[m];
  const fnUnescape = (m) => oUnescape[m];
  const replace = String.prototype.replace;

  return (Object.freeze || Object)({
    escape: (s) => replace.call(s, reEscape, fnEscape),
    unescape: (s) => replace.call(s, reUnescape, fnUnescape)
  });
})();

let buffer = new Uint8Array(0);
let offset = 0;
let chunks = [];
let chunkHeights = [];
let lineCounts = [];

export const getAnsiClasses = (part) => {
  const colors = [];

  if (part.foreground) {
    colors.push(part.foreground);
  }

  if (part.background) {
    colors.push(`bg-${part.background}`);
  }

  if (part.bold) {
    colors.push('bold');
  }

  if (part.italic) {
    colors.push('italic');
  }

  if (part.underline) {
    colors.push('underline');
  }

  return colors.join(' ');
};

export const decode = (chunk) => {
  return DECODER
    .decode(new DataView(chunk.buffer))
    .replace(CONTROL_CHARS, '\r')
    .replace(NORMALIZE_NEWLINES, '\n')
    .replace(CLEAR_ANSI, '')
    .split(NEWLINE)
    .map(parseAnsi);
};

const init = (url) => {
  const xhr = new XMLHttpRequest();

  xhr.open('GET', url);
  xhr.responseType = 'arraybuffer';
  xhr.overrideMimeType('text/plain; charset=utf-8');
  xhr.addEventListener('error', error);
  xhr.addEventListener('progress', () => xhr.response && update(xhr.response));
  xhr.addEventListener('load', () => xhr.response && (update(xhr.response) || loadEnd()));
  xhr.send();
};

const update = (response) => {
  const _buffer = new Uint8Array(response);
  const bufferLength = _buffer.length;

  if (buffer.length === bufferLength) {
    return;
  } else {
    buffer = _buffer;
  }

  let newlineCount = 0;
  let nextSliceIndex = 0;

  chunks = [];
  chunkHeights = [];

  for (let index = 0; index < bufferLength; index++) {
    if (buffer[index] === ENCODED_NEWLINE) {
      newlineCount++;
    }

    if (newlineCount !== LINE_CHUNK) {
      continue;
    }

    chunks.push(buffer.slice(nextSliceIndex, index));
    chunkHeights.push(LINE_CHUNK * MIN_LINE_HEIGHT);
    lineCounts.push(newlineCount);
    nextSliceIndex = index + 1;
    newlineCount = 0;
  }

  // Add any remaining lines that didn't fit into the exact slices
  if (nextSliceIndex < bufferLength) {
    chunks.push(buffer.slice(nextSliceIndex, bufferLength));
    chunkHeights.push(newlineCount * MIN_LINE_HEIGHT);
    lineCounts.push(newlineCount);
  }

  let overage = 0;

  if (chunks.length > CHUNK_LIMIT) {
    overage = chunks.length - CHUNK_LIMIT;
    offset = LINE_CHUNK * overage;

    chunks = chunks.slice(overage);
    chunkHeights = chunkHeights.slice(overage);
    lineCounts = lineCounts.slice(overage);
  }

  self.postMessage(JSON.stringify({ type: 'update', chunkHeights, offset, minLineHeight: MIN_LINE_HEIGHT }));
};

const error = () => self.postMessage(JSON.stringify({ type: 'error' }));
const loadEnd = () => self.postMessage(JSON.stringify({ type: 'loadend' }));

const getParagraphClass = (lineNumber, { highlightStart, highlightEnd }) => {
  return lineNumber >= highlightStart && lineNumber <= highlightEnd ?
    ' class="highlight"' :
    '';
};

// Tagged template function
function escapeHtml(pieces) {
  let result = pieces[0];
  const substitutions = [].slice.call(arguments, 1);

  substitutions.forEach((elem, i) => {
    result += util.escape(elem) + pieces[i + 1];
  });

  return result;
}

const toHtml = (index, metadata) => {
  const lines = decode(chunks[index]);
  const start = LINE_CHUNK * index + offset + 1;

  const html = lines.map((parts, index) => {
    const lineNumber = start + index;
    const pClass = getParagraphClass(lineNumber, metadata);

    return `<p${pClass}><a id="${lineNumber}">${lineNumber}</a>${parts.map((part) => {
      const className = getAnsiClasses(part);
      
      return className ?
        escapeHtml`<span class="${className}">${part.text}</span>` :
        escapeHtml`<span>${part.text}</span>`;
      }).join('')}</p>`;
  }).join('');

  self.postMessage(JSON.stringify({ type: 'decoded-index', index, html }));
};

self.addEventListener('message', (e) => {
  try {
    const data = JSON.parse(e.data);

    switch (data.type) {
      case 'start':
        return init(data.url);
      case 'decode-index':
        return toHtml(data.index, data.metadata);
    }
  } catch (err) {
    return err;
  }
});
