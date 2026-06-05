// ─── UPLOAD VALIDATION ───────────────────────────────────────
// Shared basic checks for every file upload: reject the wrong format up front
// with a clear message (multer rejections are turned into clean 400s by the
// global error handler in index.js). Size limits stay per-route via multer.
const path = require('path')

// Allowed file types by purpose. Match on extension AND, when present, mimetype.
const TYPES = {
  // Data imports (MTO / bulk commodity / equipment / WBS)
  spreadsheet: {
    exts: ['.xlsx', '.xls', '.csv'],
    label: 'a spreadsheet (.xlsx, .xls or .csv)',
  },
  // Certificates, packing lists, drawings, etc.
  document: {
    exts: ['.pdf', '.xlsx', '.xls', '.csv', '.doc', '.docx', '.png', '.jpg', '.jpeg', '.gif', '.tif', '.tiff', '.txt'],
    label: 'a PDF, Office document or image',
  },
  // Signatures / photos (e.g. Proof of Collection)
  image: {
    exts: ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'],
    label: 'an image (.png, .jpg, .gif or .webp)',
  },
}

// multer fileFilter factory. On a bad type, rejects with an isUploadError flag so
// the global handler returns a 400 (not a generic 500).
function fileFilter(kind) {
  const cfg = TYPES[kind] || TYPES.document
  return (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase()
    if (ext && cfg.exts.includes(ext)) return cb(null, true)
    const err = new Error(`Unsupported file type${ext ? ` "${ext}"` : ''}. Please upload ${cfg.label}.`)
    err.isUploadError = true
    cb(err)
  }
}

module.exports = { fileFilter, TYPES }
