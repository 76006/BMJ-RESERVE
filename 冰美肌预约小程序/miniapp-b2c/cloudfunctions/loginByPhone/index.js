/**
 * loginByPhone - 手机号登录 + 角色自动识别
 * 
 * 入参: { cloudID: string }  来自 button open-type="getPhoneNumber" 的 cloudID
 * 返回: { role: 'user'|'staff'|'superadmin', name: string, phone: string }
 */
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

exports.main = async (event) => {
  const { cloudID } = event
  const openId = cloud.getWXContext().OPENID

  if (!cloudID) {
    return { role: 'user', name: '', phone: '', error: 'missing cloudID' }
  }

  try {
    // 1. 解密手机号
    const openData = await cloud.getOpenData({ list: [cloudID] })
    if (!openData || !openData.list || !openData.list[0] || !openData.list[0].data) {
      return { role: 'user', name: '', phone: '', error: 'failed to decrypt phone' }
    }
    const phone = openData.list[0].data.phoneNumber

    if (!phone) {
      return { role: 'user', name: '', phone: '', error: 'empty phone' }
    }

    const db = cloud.database()

    // 2. 查管理员白名单（按手机号）
    const adminRes = await db.collection('admins')
      .where({ phone, active: true })
      .limit(1)
      .get()

    if (adminRes.data && adminRes.data.length > 0) {
      const admin = adminRes.data[0]

      // 绑定 openId（首次或变更时）
      if (admin.openId !== openId) {
        await db.collection('admins').doc(admin._id).update({
          data: {
            openId: openId,
            updatedAt: new Date().toISOString()
          }
        })
      }

      console.log(`[loginByPhone] 管理员登录: ${admin.name} (${admin.role}) phone=${phone}`)
      return {
        role: admin.role || 'staff',
        name: admin.name || '管理员',
        phone
      }
    }

    // 3. 普通用户 — 写 users 集合
    const userRes = await db.collection('users')
      .where({ openId })
      .limit(1)
      .get()

    if (userRes.data && userRes.data.length === 0) {
      await db.collection('users').add({
        data: {
          openId,
          phone,
          firstVisit: new Date().toISOString(),
          lastVisit: new Date().toISOString(),
          visitCount: 1
        }
      })
    } else if (userRes.data && userRes.data.length > 0) {
      await db.collection('users').doc(userRes.data[0]._id).update({
        data: {
          phone,
          lastVisit: new Date().toISOString(),
          visitCount: db.command.inc(1)
        }
      })
    }

    console.log(`[loginByPhone] 普通用户登录: phone=${phone}`)
    return { role: 'user', name: '', phone }

  } catch (err) {
    console.error('[loginByPhone] 异常:', err)
    return { role: 'user', name: '', phone: '', error: err.message }
  }
}
