const bs58 = require('bs58')
/**
 * @typedef {import('./range').Range} Range
 * @typedef {import('ppppp-db/msg-v4').Msg} Msg
 */

/**
 * @param {any} msgId
 * @return {msgId is string}
 */
function isMsgId(msgId) {
  try {
    const d = bs58.decode(msgId)
    return d.length === 32
  } catch {
    return false
  }
}

/**
 * @param {any} msgIds
 * @return {msgIds is Array<string>}
 */
function isMsgIds(msgIds) {
  if (!Array.isArray(msgIds)) return false
  return msgIds.every(isMsgId)
}

/**
 * @param {any} msgs
 * @return {msgs is Array<Msg>}
 */
function isMsgs(msgs) {
  if (!Array.isArray(msgs)) return false
  return msgs.every(isMsg)
}

/**
 * @param {any} range
 * @return {range is Range}
 */
function isRange(range) {
  if (!Array.isArray(range)) return false
  if (range.length !== 2) return false
  if (!Number.isInteger(range[0]) || !Number.isInteger(range[1])) return false
  return true
}

/**
 * @param {any} bloom
 * @return {bloom is string}
 */
function isBloom(bloom) {
  // TODO: validate when blooming is stabilized
  return !!bloom
}

/**
 * @param {any} msg
 * @returns {msg is Msg}
 */
function isMsg(msg) {
  if (!msg || typeof msg !== 'object') {
    return false
  }
  if (!('data' in msg)) {
    return false
  }
  if (!msg.metadata || typeof msg.metadata !== 'object') {
    return false
  }
  if (!('dataHash' in msg.metadata)) {
    return false
  }
  if (!('dataSize' in msg.metadata)) {
    return false
  }
  if (!('account' in msg.metadata)) {
    return false
  }
  if (!('accountTips' in msg.metadata)) {
    return false
  }
  if (!('tangles' in msg.metadata)) {
    return false
  }
  if (!('domain' in msg.metadata)) {
    return false
  }
  if (msg.metadata.v !== 4) {
    return false
  }
  if (typeof msg.sig !== 'string') {
    return false
  }
  return true
}

module.exports = {
  isMsgId,
  isMsgIds,
  isMsgs,
  isRange,
  isBloom,
  isMsg,
}
