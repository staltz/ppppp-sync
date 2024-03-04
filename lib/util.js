const bs58 = require('bs58')

/**
 * @param {string} msgId
 */
function isMsgId (msgId) {
  try {
    const d = bs58.decode(msgId)
    return d.length === 32
  } catch {
    return false
  }
}

module.exports = {
  isMsgId,
}