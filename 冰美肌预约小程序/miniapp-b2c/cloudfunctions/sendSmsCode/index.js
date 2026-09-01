// 云函数：发送短信验证码
// Mock模式：仅在显式配置 SMS_MOCK_ENABLED=true 时启用
// 正式模式：配好阿里云短信环境变量后调用「短信认证」API发送
const cloud = require('wx-server-sdk')
const crypto = require('crypto')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

// ========== 阿里云短信认证配置 ==========
// 从云函数环境变量读取（在云开发控制台 → 云函数 → 环境变量 中配置）
// 未完整配置短信服务时默认拒绝发送，禁止自动降级到 Mock
const ALI_ACCESS_KEY = process.env.ALI_ACCESS_KEY || ''
const ALI_SECRET_KEY = process.env.ALI_SECRET_KEY || ''
const ALI_SMS_SIGN = process.env.ALI_SMS_SIGN || ''
const ALI_SMS_TEMPLATE = process.env.ALI_SMS_TEMPLATE || ''
const SMS_MOCK_ENABLED = process.env.SMS_MOCK_ENABLED === 'true'
const SMS_CONFIGURED = Boolean(
  ALI_ACCESS_KEY && ALI_SECRET_KEY && ALI_SMS_SIGN && ALI_SMS_TEMPLATE
)

// ========== 验证码配置 ==========
const CODE_LENGTH = 6
const CODE_EXPIRE_MINUTES = 5         // 5分钟过期
const RATE_LIMIT_SECONDS = 60         // 同一号码60秒内最多发一次

/**
 * 生成指定长度的随机数字验证码
 */
function generateCode(length) {
  const upperBound = Math.pow(10, length)
  return crypto.randomInt(0, upperBound).toString().padStart(length, '0')
}

/**
 * 检查是否在发送频率限制内
 */
async function checkRateLimit(phone) {
  const oneMinuteAgo = new Date(Date.now() - RATE_LIMIT_SECONDS * 1000)
  const res = await db.collection('sms_codes')
    .where({
      phone: phone,
      createdAt: db.command.gte(oneMinuteAgo)
    })
    .count()
  return res.total > 0
}

/**
 * 调用阿里云短信认证API发送验证码
 */
async function sendViaAliyun(phone, code) {
  if (!SMS_CONFIGURED) {
    // 只有显式开启测试开关时才允许打印验证码
    console.log('========================================')
    console.log('[Mock SMS] TO:', phone)
    console.log('[Mock SMS] CODE:', code)
    console.log('========================================')
    return { success: true, mock: true }
  }

  // 正式模式：调用阿里云短信认证API
  // 接口：dypnsapi.aliyuncs.com / SendSmsVerifyCode
  // 签名方式：阿里云V3签名，region=cn-hangzhou
  // 文档：https://help.aliyun.com/zh/pnvs/developer-reference/api-dypnsapi-2017-05-25-sendsmsverifycode
  const https = require('https')
  const accessKeyId = ALI_ACCESS_KEY
  const accessKeySecret = ALI_SECRET_KEY

  const params = JSON.stringify({
    PhoneNumber: phone,
    SignName: ALI_SMS_SIGN,
    TemplateCode: ALI_SMS_TEMPLATE,
    TemplateParam: JSON.stringify({ code: code }),
    OutId: Date.now().toString()
  })

  // 阿里云V3签名
  const timestamp = new Date().toISOString().replace(/\.\d{3}/, '').replace(/[:-]/g, '')
  const date = timestamp.substring(0, 8)
  const action = 'SendSmsVerifyCode'
  const version = '2017-05-25'
  const endpoint = 'dypnsapi.aliyuncs.com'
  const algorithm = 'ACS3-HMAC-SHA256'

  const hashedRequestPayload = crypto.createHash('sha256').update(params).digest('hex')
  const hashedCanonicalRequest = 'POST\n/\n\ncontent-type:application/json\nhost:' + endpoint + '\nx-acs-action:' + action.toLowerCase() + '\nx-acs-content-sha256:' + hashedRequestPayload + '\nx-acs-date:' + timestamp + '\nx-acs-version:' + version + '\n\ncontent-type;host;x-acs-action;x-acs-content-sha256;x-acs-date;x-acs-version\n' + hashedRequestPayload

  const stringToSign = algorithm + '\n' + crypto.createHash('sha256').update(hashedCanonicalRequest).digest('hex')
  const signingKey = crypto.createHmac('sha256', 'aliyun_v4' + accessKeySecret).update(date).digest()
  const signature = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex')

  const authHeader = algorithm + ' Credential=' + accessKeyId + '/' + date + '/cn-hangzhou/dypnsapi/aliyun_v4_request,SignedHeaders=content-type;host;x-acs-action;x-acs-content-sha256;x-acs-date;x-acs-version,Signature=' + signature

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: endpoint,
      port: 443,
      path: '/',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Host': endpoint,
        'x-acs-action': action,
        'x-acs-version': version,
        'x-acs-date': timestamp,
        'x-acs-content-sha256': hashedRequestPayload,
        'Authorization': authHeader
      }
    }, (res) => {
      let body = ''
      res.on('data', chunk => body += chunk)
      res.on('end', () => {
        try {
          const result = JSON.parse(body)
          if (result.Code === 'OK') {
            resolve({ success: true, mock: false })
          } else {
            console.error('[SMS API Error]', result.Code, result.Message)
            resolve({ success: false, error: result.Message || result.Code })
          }
        } catch (e) {
          resolve({ success: false, error: 'API返回解析失败' })
        }
      })
    })
    req.on('error', (e) => {
      console.error('[SMS API Error]', e.message)
      resolve({ success: false, error: e.message })
    })
    req.write(params)
    req.end()
  })
}

exports.main = async (event, context) => {
  const phone = (event.phone || '').trim()
  console.log('[sendSmsCode] 请求手机号:', phone.substring(0, 3) + '****' + phone.substring(7))

  // 1. 校验手机号格式
  if (!/^1\d{10}$/.test(phone)) {
    return { success: false, error: '手机号格式不正确' }
  }

  // 未配置正式短信服务时必须显式开启 Mock，避免生产环境静默放行
  if (!SMS_CONFIGURED && !SMS_MOCK_ENABLED) {
    return { success: false, error: '短信服务未配置' }
  }

  // 2. 频率限制
  const limited = await checkRateLimit(phone)
  if (limited) {
    return { success: false, error: '发送太频繁，请60秒后再试' }
  }

  // 3. 生成验证码
  const code = generateCode(CODE_LENGTH)

  // 4. 存入数据库
  const now = new Date()
  const expiresAt = new Date(now.getTime() + CODE_EXPIRE_MINUTES * 60 * 1000)
  try {
    await db.collection('sms_codes').add({
      data: {
        phone: phone,
        code: code,
        expiresAt: expiresAt,
        used: false,
        mock: !SMS_CONFIGURED,
        createdAt: now
      }
    })
  } catch (dbErr) {
    console.error('[sendSmsCode] 数据库写入失败:', dbErr)
    return { success: false, error: '系统错误，请稍后重试' }
  }

  // 5. 发送短信
  const smsResult = await sendViaAliyun(phone, code)
  if (!smsResult.success) {
    return { success: false, error: smsResult.error || '短信发送失败' }
  }

  console.log('[sendSmsCode] 验证码已发送, phone:', phone.substring(0, 3) + '****' + phone.substring(7))
  return {
    success: true,
    mock: smsResult.mock || false,
    message: smsResult.mock ? 'Mock模式：验证码已打印到云函数日志' : '验证码已发送'
  }
}
