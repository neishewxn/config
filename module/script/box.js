/**
 * BoxJs for Egern
 * 
 * Original: https://github.com/chavyleung/scripts/blob/master/box/chavy.boxjs.js
 * Rewritten to use Egern's native JavaScript API (ctx-based module pattern).
 *
 * Egern config (YAML):
 * 
 *   scriptings:
 *     - http_request:
 *         name: "BoxJs"
 *         match: "^https?://(.+\\.)?boxjs\\.(com|net)"
 *         script_url: "chavy.boxjs.egern.js"
 *         body_required: true
 *         timeout: 120
 *
 *   mitm:
 *     hostnames:
 *       - "boxjs.com"
 *       - "*.boxjs.com"
 *       - "boxjs.net"
 *       - "*.boxjs.net"
 */

// ===================================
// Constants
// ===================================

const VERSION = '0.19.26'
const VERSION_TYPE = 'beta'

// Storage keys
const KEY_usercfgs = 'chavy_boxjs_userCfgs'
const KEY_sessions = 'chavy_boxjs_sessions'
const KEY_web_cache = 'chavy_boxjs_web_cache'
const KEY_app_subCaches = 'chavy_boxjs_app_subCaches'
const KEY_globalBaks = 'chavy_boxjs_globalBaks'
const KEY_backups = 'chavy_boxjs_backups'
const KEY_cursessions = 'chavy_boxjs_cur_sessions'
const KEY_boxjs_host = 'boxjs_host'

const WEB_URL = `https://cdn.jsdelivr.net/gh/chavyleung/scripts@${VERSION}/box/chavy.boxjs.html?_=${Date.now()}`
const VER_URL = 'https://raw.githubusercontent.com/chavyleung/scripts/master/box/release/box.release.json'

// ===================================
// Utility: lodash-like get/set
// ===================================

function lodashGet(obj, path, defaultVal) {
  const keys = path.replace(/\[(\d+)\]/g, '.$1').split('.')
  let result = obj
  for (const k of keys) {
    result = Object(result)[k]
    if (result === undefined) return defaultVal
  }
  return result
}

function lodashSet(obj, path, value) {
  if (Object(obj) !== obj) return obj
  const keys = path.toString().match(/[^.[\]]+/g) || []
  keys.slice(0, -1).reduce((acc, cur, i) =>
    Object(acc[cur]) === acc[cur]
      ? acc[cur]
      : (acc[cur] = (Math.abs(keys[i + 1]) >> 0 === +keys[i + 1] ? [] : {})),
    obj
  )[keys[keys.length - 1]] = value
  return obj
}

// ===================================
// URL helpers
// ===================================

function getHost(url) {
  return url.slice(0, url.indexOf('/', 8))
}

function getPath(url) {
  const end = url.lastIndexOf('/') === url.length - 1 ? -1 : undefined
  return url.slice(url.indexOf('/', 8), end)
}

function parseQuery(path) {
  const [, query] = path.split('?')
  if (!query) return {}
  return query.split('&').reduce((obj, cur) => {
    const [key, val] = cur.split('=')
    obj[key] = val
    return obj
  }, {})
}

// ===================================
// Storage helpers (replaces Env class)
// ===================================

function getdata(ctx, key) {
  if (/^@/.test(key)) {
    const match = /^@(.*?)\.(.*)$/.exec(key)
    if (match) {
      const [, rootKey, subPath] = match
      const rootVal = ctx.storage.get(rootKey)
      if (rootVal) {
        try {
          const obj = JSON.parse(rootVal)
          return obj ? lodashGet(obj, subPath, '') : ''
        } catch {
          return ''
        }
      }
      return ''
    }
  }
  return ctx.storage.get(key)
}

function setdata(ctx, val, key) {
  if (/^@/.test(key)) {
    const match = /^@(.*?)\.(.*)$/.exec(key)
    if (match) {
      const [, rootKey, subPath] = match
      const rootVal = ctx.storage.get(rootKey)
      const rawObj = rootKey ? (rootVal === 'null' ? null : rootVal || '{}') : '{}'
      try {
        const obj = JSON.parse(rawObj)
        lodashSet(obj, subPath, val)
        ctx.storage.set(rootKey, JSON.stringify(obj))
      } catch {
        const obj = {}
        lodashSet(obj, subPath, val)
        ctx.storage.set(rootKey, JSON.stringify(obj))
      }
      return true
    }
  }
  ctx.storage.set(key, val)
  return true
}

function getjson(ctx, key, defaultVal = null) {
  const raw = ctx.storage.get(key)
  if (raw) {
    try {
      return JSON.parse(raw)
    } catch {
      return defaultVal
    }
  }
  return defaultVal
}

function setjson(ctx, val, key) {
  try {
    ctx.storage.set(key, JSON.stringify(val))
    return true
  } catch {
    return false
  }
}

// ===================================
// CORS / Response helpers
// ===================================

function corsHeaders(extra = {}) {
  return Object.assign(
    {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST,GET,OPTIONS,PUT,DELETE',
      'Access-Control-Allow-Headers': 'Origin, X-Requested-With, Content-Type, Accept'
    },
    extra
  )
}

function respondHtml(ctx, html) {
  return ctx.respond({
    status: 200,
    headers: corsHeaders({ 'Content-Type': 'text/html;charset=UTF-8' }),
    body: html
  })
}

function respondJson(ctx, data) {
  return ctx.respond({
    status: 200,
    headers: corsHeaders({ 'Content-Type': 'application/json; charset=utf-8' }),
    body: typeof data === 'string' ? data : JSON.stringify(data)
  })
}

function respondOptions(ctx) {
  return ctx.respond({
    status: 204,
    headers: corsHeaders()
  })
}

// ===================================
// Notification helper
// ===================================

function notify(ctx, title, subtitle, body, isMute) {
  if (isMute) return
  const opts = { title: title || 'BoxJs' }
  if (subtitle) opts.subtitle = subtitle
  if (body) opts.body = body
  ctx.notify(opts)
}

// ===================================
// Data access functions
// ===================================

function getUserCfgs(ctx) {
  const defcfgs = {
    gist_cache_key: [],
    favapps: [],
    appsubs: [],
    viewkeys: [],
    isPinedSearchBar: true,
    httpapi: 'examplekey@127.0.0.1:6166',
    http_backend: ''
  }
  const usercfgs = Object.assign(defcfgs, getjson(ctx, KEY_usercfgs, {}))

  // Clean null subscriptions
  if (usercfgs.appsubs.includes(null)) {
    usercfgs.appsubs = usercfgs.appsubs.filter((sub) => sub)
    setjson(ctx, usercfgs, KEY_usercfgs)
  }

  return usercfgs
}

function getAppSubCaches(ctx) {
  return getjson(ctx, KEY_app_subCaches, {})
}

function getGlobalBaks(ctx) {
  let backups = getjson(ctx, KEY_backups, [])
  if (backups.includes(null)) {
    backups = backups.filter((bak) => bak)
    setjson(ctx, backups, KEY_backups)
  }
  return backups
}

function getAppSessions(ctx) {
  return getjson(ctx, KEY_sessions, []) || []
}

function getCurSessions(ctx) {
  return getjson(ctx, KEY_cursessions, {}) || {}
}

function getSystemCfgs(ctx) {
  return {
    env: 'Egern',
    version: VERSION,
    versionType: VERSION_TYPE,
    envs: [
      {
        id: 'Surge',
        icons: [
          'https://raw.githubusercontent.com/Orz-3/mini/none/surge.png',
          'https://raw.githubusercontent.com/Orz-3/mini/master/Color/surge.png'
        ]
      },
      {
        id: 'QuanX',
        icons: [
          'https://raw.githubusercontent.com/Orz-3/mini/none/quanX.png',
          'https://raw.githubusercontent.com/Orz-3/mini/master/Color/quantumultx.png'
        ]
      },
      {
        id: 'Loon',
        icons: [
          'https://raw.githubusercontent.com/Orz-3/mini/none/loon.png',
          'https://raw.githubusercontent.com/Orz-3/mini/master/Color/loon.png'
        ]
      },
      {
        id: 'Shadowrocket',
        icons: [
          'https://raw.githubusercontent.com/Orz-3/mini/master/Alpha/shadowrocket.png',
          'https://raw.githubusercontent.com/Orz-3/mini/master/Color/shadowrocket.png'
        ]
      },
      {
        id: 'Stash',
        icons: [
          'https://raw.githubusercontent.com/Orz-3/mini/master/Alpha/stash.png',
          'https://raw.githubusercontent.com/Orz-3/mini/master/Color/stash.png'
        ]
      },
      {
        id: 'Egern',
        icons: [
          'https://raw.githubusercontent.com/Orz-3/mini/master/Alpha/appstore.png',
          'https://raw.githubusercontent.com/Orz-3/mini/master/Color/appstore.png'
        ]
      }
    ],
    chavy: {
      id: 'ChavyLeung',
      icon: 'https://avatars3.githubusercontent.com/u/29748519',
      repo: 'https://github.com/chavyleung/scripts'
    },
    senku: {
      id: 'GideonSenku',
      icon: 'https://avatars1.githubusercontent.com/u/39037656',
      repo: 'https://github.com/GideonSenku'
    },
    id77: {
      id: 'id77',
      icon: 'https://avatars0.githubusercontent.com/u/9592236',
      repo: 'https://github.com/id77'
    },
    orz3: {
      id: 'Orz-3',
      icon: 'https://raw.githubusercontent.com/Orz-3/mini/master/Color/Orz-3.png',
      repo: 'https://github.com/Orz-3/'
    },
    boxjs: {
      id: 'BoxJs',
      show: false,
      icon: 'https://raw.githubusercontent.com/Orz-3/mini/master/Color/box.png',
      icons: [
        'https://raw.githubusercontent.com/Orz-3/mini/master/Alpha/box.png',
        'https://raw.githubusercontent.com/Orz-3/mini/master/Color/box.png'
      ],
      repo: 'https://github.com/chavyleung/scripts'
    },
    defaultIcons: [
      'https://raw.githubusercontent.com/Orz-3/mini/master/Alpha/appstore.png',
      'https://raw.githubusercontent.com/Orz-3/mini/master/Color/appstore.png'
    ]
  }
}

// ===================================
// System Apps (built-in apps data)
// ===================================

function getSystemApps() {
  const sysapps = [
    {
      id: 'BoxSetting',
      name: '偏好设置',
      descs: ['可手动执行一些抹掉数据的脚本', '可设置明暗两种主题下的主色调', '可设置壁纸清单'],
      keys: [
        '@chavy_boxjs_userCfgs.httpapi',
        '@chavy_boxjs_userCfgs.bgimg',
        '@chavy_boxjs_userCfgs.http_backend',
        '@chavy_boxjs_userCfgs.color_dark_primary',
        '@chavy_boxjs_userCfgs.color_light_primary'
      ],
      settings: [
        { id: '@chavy_boxjs_userCfgs.httpapis', name: 'HTTP-API (Surge)', val: '', type: 'textarea', placeholder: ',examplekey@127.0.0.1:6166', autoGrow: true, rows: 2, persistentHint: true, desc: '示例: ,examplekey@127.0.0.1:6166! 注意: 以逗号开头, 逗号分隔多个地址, 可加回车' },
        { id: '@chavy_boxjs_userCfgs.httpapi_timeout', name: 'HTTP-API Timeout (Surge)', val: 20, type: 'number', persistentHint: true, desc: '如果脚本作者指定了超时时间, 会优先使用脚本指定的超时时间.' },
        { id: '@chavy_boxjs_userCfgs.http_backend', name: 'HTTP Backend (Quantumult X)', val: '', type: 'text', placeholder: 'http://127.0.0.1:9999', persistentHint: true, desc: '示例: http://127.0.0.1:9999 ! 注意: 必须是以 http 开头的完整路径, 不能是 / 结尾' },
        { id: '@chavy_boxjs_userCfgs.debugger_webs', name: '调试地址', val: 'Dev体验,https://raw.githubusercontent.com/chavyleung/scripts/boxjs.dev/box/chavy.boxjs.html', type: 'textarea', placeholder: '每行一个配置，用逗号分割每个配置的名字和链接：配置,url', persistentHint: true, autoGrow: true, rows: 2, desc: '逗号分隔名字和链接, 回车分隔多个地址' },
        { id: '@chavy_boxjs_userCfgs.bgimgs', name: '背景图片清单', val: '无,\n跟随系统,跟随系统\nlight,http://api.btstu.cn/sjbz/zsy.php\ndark,https://uploadbeta.com/api/pictures/random\n妹子,http://api.btstu.cn/sjbz/zsy.php', type: 'textarea', placeholder: '无,{回车} 跟随系统,跟随系统{回车} light,图片地址{回车} dark,图片地址{回车} 妹子,图片地址', persistentHint: true, autoGrow: true, rows: 2, desc: '逗号分隔名字和链接, 回车分隔多个地址' },
        { id: '@chavy_boxjs_userCfgs.bgimg', name: '背景图片', val: '', type: 'text', placeholder: 'http://api.btstu.cn/sjbz/zsy.php', persistentHint: true, desc: '输入背景图标的在线链接' },
        { id: '@chavy_boxjs_userCfgs.changeBgImgEnterDefault', name: '手势进入壁纸模式默认背景图片', val: '', type: 'text', placeholder: '填写上面背景图片清单的值', persistentHint: true, desc: '' },
        { id: '@chavy_boxjs_userCfgs.changeBgImgOutDefault', name: '手势退出壁纸模式默认背景图片', val: '', type: 'text', placeholder: '填写上面背景图片清单的值', persistentHint: true, desc: '' },
        { id: '@chavy_boxjs_userCfgs.color_light_primary', name: '明亮色调', canvas: true, val: '#F7BB0E', type: 'colorpicker', desc: '' },
        { id: '@chavy_boxjs_userCfgs.color_dark_primary', name: '暗黑色调', canvas: true, val: '#2196F3', type: 'colorpicker', desc: '' }
      ],
      scripts: [
        { name: '抹掉：所有缓存', script: 'https://raw.githubusercontent.com/chavyleung/scripts/master/box/scripts/boxjs.revert.caches.js' },
        { name: '抹掉：收藏应用', script: 'https://raw.githubusercontent.com/chavyleung/scripts/master/box/scripts/boxjs.revert.usercfgs.favapps.js' },
        { name: '抹掉：用户偏好', script: 'https://raw.githubusercontent.com/chavyleung/scripts/master/box/scripts/boxjs.revert.usercfgs.js' },
        { name: '抹掉：所有会话', script: 'https://raw.githubusercontent.com/chavyleung/scripts/master/box/scripts/boxjs.revert.usercfgs.sessions.js' },
        { name: '抹掉：所有备份', script: 'https://raw.githubusercontent.com/chavyleung/scripts/master/box/scripts/boxjs.revert.baks.js' },
        { name: '抹掉：BoxJs (注意备份)', script: 'https://raw.githubusercontent.com/chavyleung/scripts/master/box/scripts/boxjs.revert.boxjs.js' }
      ],
      author: '@chavyleung',
      repo: 'https://github.com/chavyleung/scripts/blob/master/box/switcher/box.switcher.js',
      icons: [
        'https://raw.githubusercontent.com/chavyleung/scripts/master/box/icons/BoxSetting.mini.png',
        'https://raw.githubusercontent.com/chavyleung/scripts/master/box/icons/BoxSetting.png'
      ]
    },
    {
      id: 'BoxSwitcher',
      name: '会话切换',
      desc: '打开静默运行后, 切换会话将不再发出系统通知 \n注: 不影响日志记录',
      keys: [],
      settings: [
        { id: 'CFG_BoxSwitcher_isSilent', name: '静默运行', val: false, type: 'boolean', desc: '切换会话时不发出系统通知!' }
      ],
      author: '@chavyleung',
      repo: 'https://github.com/chavyleung/scripts/blob/master/box/switcher/box.switcher.js',
      icons: [
        'https://raw.githubusercontent.com/chavyleung/scripts/master/box/icons/BoxSwitcher.mini.png',
        'https://raw.githubusercontent.com/chavyleung/scripts/master/box/icons/BoxSwitcher.png'
      ],
      script: 'https://raw.githubusercontent.com/chavyleung/scripts/master/box/switcher/box.switcher.js'
    },
    {
      id: 'BoxGist',
      name: 'Gist备份',
      keys: ['@gist.token', '@gist.username', '@gist.split', '@gist.revision_options', '@gist.backup_type'],
      author: '@dompling',
      repo: 'https://github.com/dompling/Script/tree/master/gist',
      icons: [
        'https://raw.githubusercontent.com/Former-Years/icon/master/github-bf.png',
        'https://raw.githubusercontent.com/Former-Years/icon/master/github-bf.png'
      ],
      descs_html: [
        '<h2>Token的获取方式</h2>',
        '<p>头像菜单 -></p>',
        '<p>Settings -></p>',
        '<p>Developer settings -></p>',
        '<p>Personal access tokens -></p>',
        '<p>Generate new token -></p>',
        '<p>在里面找到 gist 勾选提交</p>',
        '<h2>Gist Revision Id</h2>',
        '<p>打开Gist项目</p>',
        '<p>默认为Code，选择Revisions</p>',
        '<p>找到需要恢复的版本文件</p>',
        '<p>点击右上角【...】>【View file】</p>',
        '<p>浏览器地址最后一串为 RevisionId</p>'
      ],
      scripts: [
        { name: '备份 Gist', script: 'https://raw.githubusercontent.com/dompling/Script/master/gist/backup.js' },
        { name: '从 Gist 恢复', script: 'https://raw.githubusercontent.com/dompling/Script/master/gist/restore.js' },
        { name: '更新历史版本', script: 'https://raw.githubusercontent.com/dompling/Script/master/gist/commit.js' }
      ],
      settings: [
        { id: '@gist.split', name: '用户数据分段', val: null, type: 'number', placeholder: '用户数据过大时，请进行拆分防止内存警告⚠️', desc: '值为数字，拆分段数比如 2 就拆分成两个 datas.' },
        { id: '@gist.revision_id', type: 'modalSelects', name: '历史版本RevisionId', desc: '不填写时，默认获取最新，恢复后会自动清空。选择无内容时，请运行上方更新历史版本', items: '@gist.revision_options' },
        {
          id: '@gist.backup_type',
          name: '备份/恢复内容',
          val: 'usercfgs,datas,sessions,curSessions,backups,appSubCaches',
          type: 'checkboxes',
          items: [
            { key: 'usercfgs', label: '用户偏好' },
            { key: 'datas', label: '用户数据' },
            { key: 'sessions', label: '应用会话' },
            { key: 'curSessions', label: '当前会话' },
            { key: 'backups', label: '备份索引' },
            { key: 'appSubCaches', label: '应用订阅缓存' }
          ]
        },
        { id: '@gist.username', name: '用户名', val: null, type: 'text', placeholder: 'github 用户名', desc: '必填' },
        { id: '@gist.token', name: 'Personal access tokens', val: null, type: 'text', placeholder: 'github personal access tokens', desc: '必填' }
      ]
    }
  ]
  return sysapps
}

// ===================================
// App data helpers
// ===================================

function getAppDatas(ctx, app) {
  const datas = {}
  const nulls = [null, undefined, 'null', 'undefined']

  if (app.keys && Array.isArray(app.keys)) {
    app.keys.forEach((key) => {
      const val = getdata(ctx, key)
      datas[key] = nulls.includes(val) ? null : val
    })
  }

  if (app.settings && Array.isArray(app.settings)) {
    app.settings.forEach((setting) => {
      const key = setting.id
      const dataval = getdata(ctx, key)
      datas[key] = nulls.includes(dataval) ? null : dataval

      if (setting.type === 'boolean') {
        setting.val = nulls.includes(dataval) ? setting.val : (dataval === 'true' || dataval === true)
      } else if (setting.type === 'int') {
        setting.val = dataval * 1 || setting.val
      } else if (setting.type === 'checkboxes') {
        if (!nulls.includes(dataval) && typeof dataval === 'string') {
          setting.val = dataval ? dataval.split(',') : []
        } else {
          setting.val = Array.isArray(setting.val) ? setting.val : setting.val.split(',')
        }
      } else {
        setting.val = dataval || setting.val
      }

      if (setting.type === 'modalSelects') {
        setting.items = datas?.[setting.items] || []
      }
    })
  }

  return datas
}

function getBoxData(ctx) {
  const datas = {}

  const extraDatasRaw = getdata(ctx, `${KEY_usercfgs.replace('#', '@')}.gist_cache_key`)
  const extraDatas = extraDatasRaw ? (Array.isArray(extraDatasRaw) ? extraDatasRaw : []) : []
  extraDatas.forEach((key) => {
    datas[key] = getdata(ctx, key)
  })

  const usercfgs = getUserCfgs(ctx)
  const sessions = getAppSessions(ctx)
  const curSessions = getCurSessions(ctx)
  const sysapps = getSystemApps()
  const syscfgs = getSystemCfgs(ctx)
  const appSubCaches = getAppSubCaches(ctx)
  const globalbaks = getGlobalBaks(ctx)

  // Merge persisted data from system apps
  sysapps.forEach((app) => {
    Object.assign(datas, getAppDatas(ctx, app))
  })

  // Merge persisted data from subscription apps
  usercfgs.appsubs.forEach((sub) => {
    const subcache = appSubCaches[sub.url]
    if (subcache && subcache.apps && Array.isArray(subcache.apps)) {
      subcache.apps.forEach((app) => {
        Object.assign(datas, getAppDatas(ctx, app))
      })
    }
  })

  return {
    datas,
    usercfgs,
    sessions,
    curSessions,
    sysapps,
    syscfgs,
    appSubCaches,
    globalbaks
  }
}

// ===================================
// Page handler
// ===================================

async function handlePage(ctx, isMute) {
  const boxdata = getBoxData(ctx)
  boxdata.syscfgs.isDebugMode = false

  const isDebugWeb = [true, 'true'].includes(getdata(ctx, '@chavy_boxjs_userCfgs.isDebugWeb'))
  const debugger_web = getdata(ctx, '@chavy_boxjs_userCfgs.debugger_web')
  const cache = getjson(ctx, KEY_web_cache, null)

  let html

  if (!isDebugWeb && cache && cache.version === VERSION) {
    html = cache.cache
  } else {
    let webUrl = WEB_URL
    if (isDebugWeb && debugger_web) {
      const isQueryUrl = debugger_web.includes('?')
      webUrl = `${debugger_web}${isQueryUrl ? '&' : '?'}_=${Date.now()}`
      boxdata.syscfgs.isDebugMode = true
      console.log(`[WARN] 调试模式: webUrl = ${webUrl}`)
    }

    const getcache = () => {
      console.log('[ERROR] 调试模式: 正在使用缓存的页面!')
      boxdata.syscfgs.isDebugMode = false
      const c = getjson(ctx, KEY_web_cache, null)
      return c ? c.cache : ''
    }

    try {
      const resp = await ctx.http.get(webUrl)
      const body = await resp.text()
      if (/BoxJs /.test(body)) {
        html = body
        setjson(ctx, { version: VERSION, cache: html }, KEY_web_cache)
      } else {
        html = getcache()
      }
    } catch {
      html = getcache()
    }
  }

  // Theme replacement
  const theme = getdata(ctx, '@chavy_boxjs_userCfgs.theme')
  if (theme === 'light') {
    html = html.replace('#121212', '#fff')
  } else if (theme === 'dark') {
    html = html.replace('#fff', '#121212')
  }

  // Server-side render data injection
  html = html.replace('boxServerData: null', 'boxServerData:' + JSON.stringify(boxdata))

  // Debug mode: use vue.js instead of vue.min.js
  if (isDebugWeb && debugger_web) {
    html = html.replace('vue.min.js', 'vue.js')
  }

  return respondHtml(ctx, html)
}

// ===================================
// Query handler
// ===================================

async function handleQuery(ctx, path, isMute) {
  const referer = ctx.request.headers.get('referer') || ''
  if (!/^https?:\/\/(.+\.)?boxjs\.(com|net)\//.test(referer)) {
    const isMuteQueryAlert = [true, 'true'].includes(getdata(ctx, '@chavy_boxjs_userCfgs.isMuteQueryAlert'))

    if (!isMuteQueryAlert) {
      notify(
        ctx,
        'BoxJs',
        '❗️发现有脚本或人正在读取你的数据',
        [
          '请注意数据安全, 你可以: ',
          '1. 在 BoxJs 的脚本日志中查看详情',
          '2. 在 BoxJs 的页面 (侧栏) 中 "不显示查询警告"'
        ].join('\n'),
        false // force not mute for this warning
      )
    }

    console.log([
      '',
      '❗️❗️❗️ 发现有脚本或人正在读取你的数据 ❗️❗️❗️',
      `URL: ${ctx.request.url}`,
      ''
    ].join('\n'))
  }

  const [, query] = path.split('/query')

  if (/^\/boxdata/.test(query)) {
    return respondJson(ctx, getBoxData(ctx))
  } else if (/^\/baks/.test(query)) {
    const [, backupId] = query.split('/baks/')
    return respondJson(ctx, getjson(ctx, backupId))
  } else if (/^\/versions$/.test(query)) {
    try {
      const resp = await ctx.http.get(VER_URL)
      const data = await resp.json()
      return respondJson(ctx, data)
    } catch {
      return respondJson(ctx, {})
    }
  } else if (/^\/data/.test(query)) {
    const [, dataKey] = query.split('/data/')
    return respondJson(ctx, { key: dataKey, val: getdata(ctx, dataKey) })
  }

  return respondJson(ctx, {})
}

// ===================================
// API handler + all API implementations
// ===================================

async function handleApi(ctx, path, isMute) {
  const [, api] = path.split('/api')
  const apiPath = api.split('?')[0]

  // Parse body once — it's a stream and can only be consumed once
  let body = {}
  try {
    body = await ctx.request.json()
  } catch {
    // empty or invalid body
  }

  const queries = parseQuery(path)

  switch (apiPath) {
    case '/save':
      return respondJson(ctx, apiSave(ctx, body, queries))
    case '/addAppSub':
      return respondJson(ctx, await apiAddAppSub(ctx, body))
    case '/deleteAppSub':
      return respondJson(ctx, apiDeleteAppSub(ctx, body))
    case '/reloadAppSub':
      return respondJson(ctx, await apiReloadAppSub(ctx, body))
    case '/delGlobalBak':
      return respondJson(ctx, apiDelGlobalBak(ctx, body))
    case '/updateGlobalBak':
      return respondJson(ctx, apiUpdateGlobalBak(ctx, body))
    case '/saveGlobalBak':
      return respondJson(ctx, apiSaveGlobalBak(ctx, body))
    case '/impGlobalBak':
      return respondJson(ctx, apiImpGlobalBak(ctx, body))
    case '/revertGlobalBak':
      return respondJson(ctx, apiRevertGlobalBak(ctx, body))
    case '/runScript':
      return respondJson(ctx, await apiRunScript(ctx, body, isMute))
    case '/saveData':
      return respondJson(ctx, apiSaveData(ctx, body))
    case '/update':
      return respondJson(ctx, apiUpdate(ctx, body))
    default:
      return respondJson(ctx, { error: 'unknown api' })
  }
}

// --- /api/save ---
function dealKey(ctx, str) {
  const [rootKey, delIndex] = str.split('.')
  if (rootKey && rootKey.indexOf('@') > -1 && delIndex !== undefined) {
    const key = rootKey.replace('@', '')
    try {
      const datas = JSON.parse(getdata(ctx, key))
      if (Array.isArray(datas) && delIndex < datas.length) {
        datas.splice(delIndex, 1)
        setdata(ctx, JSON.stringify(datas), key)
      }
    } catch (e) {
      console.log(`[dealKey] Error: ${e}`)
    }
  }
}

function apiSave(ctx, data, queries) {
  if (Array.isArray(data)) {
    data.forEach((dat) => {
      if (dat.val === null) {
        dealKey(ctx, dat.key)
      } else {
        setdata(ctx, dat.val, dat.key)
      }
    })
  } else {
    if (data.val === null) {
      dealKey(ctx, data.key)
    } else {
      setdata(ctx, data.val, data.key)
    }
  }

  const appId = queries['appid']
  if (appId) {
    updateCurSessions(ctx, appId, data)
  }

  return getBoxData(ctx)
}

// --- /api/update ---
function updateNestedObj(obj, path, value) {
  const keys = path.split('.')
  let current = obj
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i]
    if (current[key] === undefined || current[key] === null) {
      current[key] = {}
    }
    current = current[key]
  }
  current[keys[keys.length - 1]] = value
}

function apiUpdate(ctx, data) {
  const pathParts = data.path.split('.')
  const val = data.val
  const key = pathParts.shift()

  if (pathParts.join('.') && Object.prototype.hasOwnProperty.call(data, 'val')) {
    switch (key) {
      case 'usercfgs': {
        const usercfgs = getUserCfgs(ctx)
        updateNestedObj(usercfgs, pathParts.join('.'), val)
        setjson(ctx, usercfgs, KEY_usercfgs)
        break
      }
      default:
        break
    }
  }

  return getBoxData(ctx)
}

// --- /api/addAppSub ---
async function apiAddAppSub(ctx, sub) {
  const usercfgs = getUserCfgs(ctx)
  usercfgs.appsubs.push(sub)
  setjson(ctx, usercfgs, KEY_usercfgs)
  await reloadAppSubCache(ctx, sub.url)
  return getBoxData(ctx)
}

// --- /api/deleteAppSub ---
function apiDeleteAppSub(ctx, sub) {
  const usercfgs = getUserCfgs(ctx)
  usercfgs.appsubs = usercfgs.appsubs.filter((e) => e.url !== sub.url)
  setjson(ctx, usercfgs, KEY_usercfgs)
  return getBoxData(ctx)
}

// --- /api/reloadAppSub ---
async function apiReloadAppSub(ctx, sub) {
  if (sub && sub.url) {
    await reloadAppSubCache(ctx, sub.url)
  } else {
    await reloadAppSubCaches(ctx)
  }
  return getBoxData(ctx)
}

// --- /api/delGlobalBak ---
function apiDelGlobalBak(ctx, backup) {
  const backups = getjson(ctx, KEY_backups, [])
  const bakIdx = backups.findIndex((b) => b.id === backup.id)
  if (bakIdx > -1) {
    backups.splice(bakIdx, 1)
    ctx.storage.delete(backup.id)
    setjson(ctx, backups, KEY_backups)
  }
  return getBoxData(ctx)
}

// --- /api/updateGlobalBak ---
function apiUpdateGlobalBak(ctx, body) {
  const { id: backupId, name: backupName } = body
  const backups = getjson(ctx, KEY_backups, [])
  const backup = backups.find((b) => b.id === backupId)
  if (backup) {
    backup.name = backupName
    setjson(ctx, backups, KEY_backups)
  }
  return getBoxData(ctx)
}

// --- /api/saveGlobalBak ---
function apiSaveGlobalBak(ctx, backup) {
  const backups = getjson(ctx, KEY_backups, [])
  const boxdata = getBoxData(ctx)
  const backupData = {}
  backupData['chavy_boxjs_userCfgs'] = boxdata.usercfgs
  backupData['chavy_boxjs_sessions'] = boxdata.sessions
  backupData['chavy_boxjs_cur_sessions'] = boxdata.curSessions
  backupData['chavy_boxjs_app_subCaches'] = boxdata.appSubCaches
  Object.assign(backupData, boxdata.datas)
  backups.push(backup)
  setjson(ctx, backups, KEY_backups)
  setjson(ctx, backupData, backup.id)
  return getBoxData(ctx)
}

// --- /api/impGlobalBak ---
function apiImpGlobalBak(ctx, backup) {
  const backups = getjson(ctx, KEY_backups, [])
  const backupData = backup.bak
  delete backup.bak
  backups.push(backup)
  setjson(ctx, backups, KEY_backups)
  setjson(ctx, backupData, backup.id)
  return getBoxData(ctx)
}

// --- /api/revertGlobalBak ---
function apiRevertGlobalBak(ctx, body) {
  const { id: backupId } = body
  const backup = getjson(ctx, backupId)
  if (backup) {
    const {
      chavy_boxjs_sysCfgs,
      chavy_boxjs_sysApps,
      chavy_boxjs_sessions,
      chavy_boxjs_userCfgs,
      chavy_boxjs_cur_sessions,
      chavy_boxjs_app_subCaches,
      ...datas
    } = backup

    setdata(ctx, JSON.stringify(chavy_boxjs_sessions), KEY_sessions)
    setdata(ctx, JSON.stringify(chavy_boxjs_userCfgs), KEY_usercfgs)
    setdata(ctx, JSON.stringify(chavy_boxjs_cur_sessions), KEY_cursessions)
    setdata(ctx, JSON.stringify(chavy_boxjs_app_subCaches), KEY_app_subCaches)

    const isNull = (val) => [undefined, null, 'null', 'undefined', ''].includes(val)
    Object.keys(datas).forEach((datkey) => {
      setdata(ctx, isNull(datas[datkey]) ? '' : `${datas[datkey]}`, datkey)
    })
  }
  return getBoxData(ctx)
}

// --- /api/runScript ---
async function apiRunScript(ctx, opts, isMute) {
  let scriptText = null

  if (opts.isRemote) {
    try {
      const resp = await ctx.http.get(opts.url)
      scriptText = await resp.text()
    } catch (e) {
      return { error: `Failed to fetch script: ${e}` }
    }
  } else {
    scriptText = opts.script
  }

  if (!scriptText) {
    return { error: 'No script text' }
  }

  // Inject $argument if provided
  if (opts.argument) {
    scriptText = `globalThis.$argument=\`${opts.argument}\`;${scriptText}`
  }

  // Execute via eval with captured logs
  // Note: In Egern, we always eval locally (no Surge HTTP-API equivalent)
  const cachedLogs = []
  const originalLog = console.log
  console.log = (l) => {
    originalLog(l)
    cachedLogs.push(l)
  }

  let result = null
  try {
    // Create a resolve function to capture $done() calls
    let resolveFunc = null
    const donePromise = new Promise((resolve) => { resolveFunc = resolve })

    // Replace $done references so eval'd scripts can call it
    scriptText = scriptText.replace(/\$done/g, '__boxjs_done__')
    scriptText = scriptText.replace(/\$\.done/g, '__boxjs_done__')

    // Provide a minimal compatibility layer for eval'd scripts
    // The eval'd script may expect Surge/QX globals
    globalThis.__boxjs_done__ = resolveFunc

    eval(scriptText)

    // Wait for script completion with a timeout
    const timeout = (opts.timeout || 10) * 1000
    result = await Promise.race([
      donePromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('Script timeout')), timeout))
    ]).catch((e) => {
      cachedLogs.push(`Error: ${e.message || e}`)
      return null
    })
  } catch (e) {
    cachedLogs.push(`Eval error: ${e.message || e}`)
  } finally {
    console.log = originalLog
    delete globalThis.__boxjs_done__
  }

  return {
    result,
    output: cachedLogs.join('\n')
  }
}

// --- /api/saveData ---
function apiSaveData(ctx, body) {
  const { key: dataKey, val: dataVal } = body
  setdata(ctx, dataVal, dataKey)
  return {
    key: dataKey,
    val: getdata(ctx, dataKey)
  }
}

// ===================================
// Subscription management
// ===================================

async function reloadAppSubCache(ctx, url) {
  const requrl = `${url}${url.includes('?') ? '&' : '?'}_=${Date.now()}`
  try {
    const resp = await ctx.http.get(requrl)
    const body = await resp.text()
    const subcaches = getAppSubCaches(ctx)
    try {
      subcaches[url] = JSON.parse(body)
    } catch {
      console.log(`更新订阅, JSON解析失败! ${url}`)
      return
    }
    subcaches[url].updateTime = new Date().toISOString()
    // Only cache subscriptions that have an id
    Object.keys(subcaches).forEach((key) => {
      if (!subcaches[key].hasOwnProperty('id')) {
        delete subcaches[key]
      }
    })
    setjson(ctx, subcaches, KEY_app_subCaches)
    console.log(`更新订阅, 成功! ${url}`)
  } catch (e) {
    console.log(`更新订阅, 失败! ${url}`, e)
  }
}

async function limitConcurrency(tasks, limit) {
  const results = []
  const executing = []

  for (const task of tasks) {
    const promise = Promise.resolve().then(() => task())
    results.push(promise)

    if (tasks.length >= limit) {
      const exec = promise.then(() => {
        const idx = executing.indexOf(exec)
        if (idx !== -1) executing.splice(idx, 1)
      }).catch(() => {
        const idx = executing.indexOf(exec)
        if (idx !== -1) executing.splice(idx, 1)
      })
      executing.push(exec)

      if (executing.length >= limit) {
        await Promise.race(executing)
      }
    }
  }

  return Promise.all(results)
}

async function reloadAppSubCaches(ctx) {
  const startTime = Date.now()
  ctx.notify({ title: 'BoxJs', body: '更新订阅: 开始!' })

  const usercfgs = getUserCfgs(ctx)
  const reloadActs = usercfgs.appsubs.map((sub) => () => reloadAppSubCache(ctx, sub.url))

  await limitConcurrency(reloadActs, 20)

  console.log('全部订阅, 完成!')
  const costTime = ((Date.now() - startTime) / 1000).toFixed(1)
  ctx.notify({ title: 'BoxJs', body: `更新订阅: 完成! 🕛 ${costTime} 秒` })
}

// ===================================
// Data migration / upgrade
// ===================================

function upgradeUserData(ctx) {
  const usercfgs = getUserCfgs(ctx)
  const isNeedUpgrade = !!usercfgs.appsubCaches

  if (isNeedUpgrade) {
    // Migrate subscription caches to separate storage
    setjson(ctx, usercfgs.appsubCaches, KEY_app_subCaches)
    delete usercfgs.appsubCaches
    usercfgs.appsubs.forEach((sub) => {
      delete sub._raw
      delete sub.apps
      delete sub.isErr
      delete sub.updateTime
    })
    setjson(ctx, usercfgs, KEY_usercfgs)
  }
}

function upgradeGlobalBaks(ctx) {
  let oldbaks = getdata(ctx, KEY_globalBaks)
  let newbaks = getjson(ctx, KEY_backups, [])
  const isEmpty = (bak) => [undefined, null, ''].includes(bak)
  const isExistsInNew = (backupId) => newbaks.find((bak) => bak.id === backupId)

  if (!isEmpty(oldbaks)) {
    try {
      oldbaks = JSON.parse(oldbaks)
    } catch {
      setdata(ctx, '', KEY_globalBaks)
      return
    }

    oldbaks.forEach((bak) => {
      if (isEmpty(bak)) return
      if (isEmpty(bak.bak)) return
      if (isExistsInNew(bak.id)) return

      console.log(`正在迁移: ${bak.name}`)
      const backupId = bak.id
      const backupData = bak.bak

      delete bak.bak
      newbaks.push(bak)

      setjson(ctx, backupData, backupId)
    })
    setjson(ctx, newbaks, KEY_backups)
  }

  // Clear old backup data
  setdata(ctx, '', KEY_globalBaks)
}

// ===================================
// Session management
// ===================================

function updateCurSessions(ctx, appId, data) {
  if (!appId) {
    console.log('[updateCurSessions] 跳过! 没有指定 appId!')
    return
  }

  const curSessions = getCurSessions(ctx)
  const curSessionId = curSessions[appId]
  if (!curSessionId) {
    console.log(`[updateCurSessions] 跳过! 应用 [${appId}] 找不到当前会话, 请先应用会话!`)
    return
  }

  const sessions = getAppSessions(ctx)
  const session = sessions.find((s) => s.id === curSessionId)
  if (!session) {
    console.log(`[updateCurSessions] 跳过! 应用 [${appId}] 找不到当前会话, 请先应用会话!`)
    return
  }

  session.datas = data
  setjson(ctx, sessions, KEY_sessions)
}

// ===================================
// Main entry point (Egern module pattern)
// ===================================

export default async function (ctx) {
  const startTime = Date.now()

  try {
    const isMute = [true, 'true'].includes(getdata(ctx, '@chavy_boxjs_userCfgs.isMute'))
    const url = ctx.request.url
    const method = ctx.request.method
    const path = getPath(url)

    // Upgrade data structures
    upgradeUserData(ctx)
    upgradeGlobalBaks(ctx)

    // Route request
    if (method === 'OPTIONS') {
      return respondOptions(ctx)
    }

    const isQuery = method === 'GET' && /^\/query\/.*?/.test(path)
    const isApi = method === 'POST' && /^\/api\/.*?/.test(path)
    const isPage = method === 'GET' && !isQuery && !isApi

    // Record the host being used
    setdata(ctx, getHost(url), KEY_boxjs_host)

    if (isPage) {
      return await handlePage(ctx, isMute)
    } else if (isQuery) {
      return await handleQuery(ctx, path, isMute)
    } else if (isApi) {
      return await handleApi(ctx, path, isMute)
    }

    // Fallback
    return respondJson(ctx, { error: 'unhandled request' })
  } catch (e) {
    console.log(`[BoxJs] Error: ${e.message || e}`)
    const costTime = ((Date.now() - startTime) / 1000).toFixed(1)
    console.log(`[BoxJs] 🕛 ${costTime} 秒`)
    return respondJson(ctx, { error: String(e) })
  }
}
