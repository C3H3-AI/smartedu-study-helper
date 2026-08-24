// ==UserScript==
// @name         智慧中小学秒刷!!完全免费一键完成!!国家中小学智慧教育平台·2026暑期教师研修·秒刷学习助手
// @namespace    https://basic.smartedu.cn/
// @version      1.2.1
// @description  2026暑期教师研修刷网课脚本，含只读自检，秒刷完成。零外链/零GM权限/可审计。完全免费，赞助自愿。思路参考 GreasyFork 501475，代码独立编写。
// @license      GPL-3.0
// @tag        学习助手
// @tag        暑期研修
// @tag        自动化
// @match        https://basic.smartedu.cn/training/*
// @match        https://basic.smartedu.cn/teacherTraining/*
// @icon         https://basic.smartedu.cn/favicon.ico
// @run-at       document-idle
// ==/UserScript==
(function () {
  'use strict';
  const SDP_APP_ID = 'e5649925-441d-4a53-b525-51a2f1c4e0a8';
  const TRAINING_ID = 'dc6d78f2-bad8-4d09-b8da-0d758803dbe4';
  const LIBRARY_REF = 'bb042e69-9a11-49a1-af22-0c3fab2e92b9';
  const CDN_POOL = ['s-file-1', 's-file-2', 'bdcs-file-1', 'bdcs-file-2'];
  const TRAIN_TAG_SET = '2026年\u201c暑期教师研修\u201d专题（基础教育）';
  const TRAIN_ORIGIN_LABEL = '2026年\u201c暑期教师研修\u201d专题';
  const PANEL_POS_KEY = 'seSafePanelPos';
  const COURSE_INJECTION_COUNTS = new Map([
    ['大力弘扬教育家精神', 8],
    ['数智素养提升', 8],
    ['科学素养提升', 1],
    ['心理健康教育能力提升', 1],
    ['学校美育浸润行动', 6]
  ]);
  const ELECTIVE_COURSE_TITLE = '学校美育浸润行动';
  const ELECTIVE_TARGET_HOURS = 3;
  const QR_WECHAT = 'https://picui.ogmua.cn/s1/2026/08/16/6a810d336bc46.webp';
  const QR_ALIPAY = 'https://picui.ogmua.cn/s1/2026/08/16/6a810d3374c0e.webp';
  const ALLOWED_HOSTS = new Set([
    'x-study-record-api.ykt.eduyun.cn',
    'elearning-train-api.ykt.eduyun.cn',
    'elearning-train-gateway.ykt.eduyun.cn',
    'elearning-train-gateway-safe.ykt.eduyun.cn'
  ]);
  for (const h of CDN_POOL) ALLOWED_HOSTS.add(h + '.ykt.cbern.com.cn');
  let aborted = false;
  let busy = false;
  let courseData = [];
  let logs = [];
  let panelNode = null;
  let isCollapsed = false;
  function safeFetch(url, options) {
    const u = new URL(url);
    if (!ALLOWED_HOSTS.has(u.hostname)) {
      return Promise.reject(new Error('blocked host: ' + u.hostname));
    }
    return fetch(u.href, options);
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function readAuthToken() {
    const pat = /ND_UC_AUTH-([0-9a-fA-F-]+)&ncet-xedu&token/;
    for (const k in localStorage) {
      const m = k.match(pat);
      if (m) {
        try {
          const v = JSON.parse(localStorage.getItem(k));
          const t = typeof v.value === 'string' ? JSON.parse(v.value) : v.value;
          if (t && t.mac_key && t.access_token) {
            return { appId: m[1], userId: String(t.user_id), userIdNum: t.user_id, token: t };
          }
        } catch (e) {  }
      }
    }
    return null;
  }
  const enc = new TextEncoder();
  function bytesToB64(buf) {
    let s = '';
    const bytes = new Uint8Array(buf);
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s);
  }
  async function hmacB64(secret, data) {
    const key = await crypto.subtle.importKey(
      'raw', enc.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false, ['sign']
    );
    const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data));
    return bytesToB64(sig);
  }
  async function signRequest(url, method) {
    const info = readAuthToken();
    if (!info) throw new Error('no token');
    const nonce = Date.now() + ':' + Math.random().toString(36).slice(2, 10).toUpperCase();
    const u = new URL(url);
    const raw = nonce + '\n' + method + '\n' + u.pathname + u.search + '\n' + u.hostname + '\n';
    const mac = await hmacB64(info.token.mac_key, raw);
    return 'MAC id="' + info.token.access_token + '",nonce="' + nonce + '",mac="' + mac + '"';
  }
  async function makeAuthHeaders(url, method) {
    return {
      'content-type': 'application/json',
      authorization: await signRequest(url, method),
      'sdp-app-id': SDP_APP_ID
    };
  }
  async function cdnRequest(path) {
    for (const h of CDN_POOL) {
      try {
        const r = await fetch('https://' + h + '.ykt.cbern.com.cn' + path);
        if (r.ok) return await r.json();
      } catch (e) {  }
    }
    return null;
  }
  const loadCourseList = function () {
    return cdnRequest('/teach/api_static/trains/2026jjsqpx/train_courses.json');
  };
  const loadCourseInfo = function (id) {
    return cdnRequest('/teach/s_course/v2/business_courses/' + id + '/course_relative_infos/zh-CN.json');
  };
  const loadActivityTree = function (asId) {
    return cdnRequest('/teach/s_course/v2/activity_sets/' + asId + '/fulls.json');
  };
  async function fetchStudyRecord(courseId) {
    const info = readAuthToken();
    if (!info) return undefined;
    const url = 'https://x-study-record-api.ykt.eduyun.cn/v1/study_details/' + courseId + '/' + info.userId;
    try {
      const r = await safeFetch(url, { headers: await makeAuthHeaders(url, 'GET') });
      if (r.status === 204 || r.status === 404) return null;
      if (r.ok) {
        const text = await r.text();
        return text.trim() ? JSON.parse(text) : null;
      }
    } catch (e) {  }
    return undefined;
  }
  async function fetchCourseHours() {
    const info = readAuthToken();
    if (!info) return {};
    const url = 'https://elearning-train-api.ykt.eduyun.cn/v1/users/' + info.userId +
      '/trains/' + TRAINING_ID + '/courses_period/actions/list';
    try {
      const r = await safeFetch(url, { headers: await makeAuthHeaders(url, 'GET') });
      if (r.ok) return await r.json();
    } catch (e) {  }
    return {};
  }
  function targetHours(course) {
    if (course.phase_id) return ELECTIVE_TARGET_HOURS;
    const max = parseFloat(course.maxPeriod);
    return max > 0 ? max : 3;
  }
  function readPeriod(periods, courseId, fallback) {
    const raw = periods && periods[courseId];
    if (raw === undefined || raw === null || raw === '') return Number(fallback) || 0;
    const value = Number(raw);
    return Number.isFinite(value) ? value : (Number(fallback) || 0);
  }
  async function waitForCourseHours(courseId, previousPeriod, target) {
    let period = Number(previousPeriod) || 0;
    for (let i = 0; i < 4; i++) {
      if (i > 0) await delay(500);
      const periods = await fetchCourseHours();
      const next = readPeriod(periods, courseId, period);
      if (next > period) period = next;
      if (period >= target || period > previousPeriod) break;
    }
    return period;
  }
  async function pushStudyRecord(courseId, courseName, coverUrl, topicType, progress, extInfoRaw) {
    const info = readAuthToken();
    if (!info) return false;
    const url = 'https://x-study-record-api.ykt.eduyun.cn/v1/study_details';
    const body = {
      user_id: info.userIdNum,
      resource_id: courseId,
      resource_name: courseName,
      resource_type: 't_course',
      catalog_type: 'teacherTraining',
      topic_type: topicType,
      progress: progress,
      status: progress > 0 ? 1 : 0,
      ext_info: JSON.stringify(extInfoRaw)
    };
    try {
      const r = await safeFetch(url, {
        method: 'POST',
        headers: await makeAuthHeaders(url, 'POST'),
        body: JSON.stringify(body)
      });
      return r.ok;
    } catch (e) { return false; }
  }
  async function syncProgress(kind, courseId, courseName, topicType, progress, extInfoRaw) {
    const info = readAuthToken();
    if (!info) return false;
    const host = kind === 'begin'
      ? 'elearning-train-gateway-safe.ykt.eduyun.cn'
      : 'elearning-train-gateway.ykt.eduyun.cn';
    const action = kind === 'begin' ? 'async_begin' : 'async';
    const url = 'https://' + host + '/v1/spi/trains/' + TRAINING_ID + '/courses/' +
      courseId + '/progress/actions/' + action;
    const body = {
      user_id: info.userIdNum,
      resource_id: courseId,
      resource_name: courseName,
      resource_type: 't_course',
      catalog_type: 'teacherTraining',
      topic_type: topicType,
      progress: progress,
      status: progress > 0 ? 1 : 0,
      ext_info: JSON.stringify(extInfoRaw)
    };
    try {
      const r = await safeFetch(url, {
        method: 'POST',
        headers: await makeAuthHeaders(url, 'POST'),
        body: JSON.stringify(body)
      });
      return r.ok;
    } catch (e) { return false; }
  }
  async function savePlaybackPos(resourceId, position) {
    const info = readAuthToken();
    if (!info) return false;
    const url = 'https://x-study-record-api.ykt.eduyun.cn/v1/resource_learning_positions/' +
      resourceId + '/' + info.userId;
    try {
      const r = await safeFetch(url, {
        method: 'PUT',
        headers: await makeAuthHeaders(url, 'PUT'),
        body: JSON.stringify({ position: position })
      });
      return r.ok;
    } catch (e) { return false; }
  }
  function parseActivities(fullsData) {
    const activities = [];
    function walk(node) {
      if (!node) return;
      if (node.node_type === 'catalog' && node.child_nodes) {
        node.child_nodes.forEach(walk);
      } else if (node.node_type === 'activity') {
        const actRes =
          (node.relations && node.relations.activity && node.relations.activity.activity_resources) || [];
        activities.push({
          activity_id: node.node_id,
          activity_name: node.node_name,
          resources: actRes.map(function (r) {
            return {
              resource_id: r.resource_id,
              duration: (r.video_extend && r.video_extend.duration) || r.study_time || 0,
              type: r.resource_type_code || 'video'
            };
          })
        });
      }
    }
    (fullsData.nodes || []).forEach(walk);
    return activities;
  }
  function buildProgressInfo(course, allActivities, activitiesToComplete, existing) {
    const base = existing || {};
    const activityProgress = Object.assign({}, base.activity_progress || {});
    const resourceProgress = Object.assign({}, base.resource_progress || {});
    const maxPos = Object.assign({}, base.resource_max_pos || {});
    const lastResource = Object.assign({}, base.activity_last_learning_resource || {});
    let lastActivity = base.last_learning_activity || null;
    for (const act of activitiesToComplete) {
      activityProgress[act.activity_id] = 2;
      for (const res of act.resources) {
        resourceProgress[res.resource_id] = 2;
        maxPos[res.resource_id] = {
          pos: res.duration > 0 ? res.duration + 1 : 1,
          type: res.duration > 0 ? 'video' : 'document'
        };
        lastResource[act.activity_id] = res.resource_id;
      }
      lastActivity = { activity_id: act.activity_id, title: act.activity_name };
    }
    const doneActs = allActivities.filter(function (act) {
      return activityProgress[act.activity_id] === 2;
    }).length;
    const progress = allActivities.length > 0
      ? Math.min(100, Math.max(0, Math.round(doneActs / allActivities.length * 100)))
      : 0;
    const raw = {
      cv: 1,
      platform: 'web',
      tags: TRAIN_TAG_SET,
      origin: TRAIN_ORIGIN_LABEL,
      cover: course.front_cover_url || course.cover || '',
      last_learning_activity: lastActivity,
      activity_last_learning_resource: lastResource,
      activity_progress: activityProgress,
      resource_progress: resourceProgress,
      miniwork_progress: base.miniwork_progress || {},
      resource_max_pos: maxPos,
      activity_exam_progress: base.activity_exam_progress || {},
      activity_event: base.activity_event || {},
      resource_study_time_ignore: base.resource_study_time_ignore || [],
      additional_params: { library_id: LIBRARY_REF }
    };
    return { raw: raw, progress: progress };
  }
  function logMsg(msg) {
    const ts = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    logs.unshift('[' + ts + '] ' + msg);
    if (logs.length > 200) logs.length = 200;
    console.log('[研修·安全版]', msg);
    refreshPanel();
  }
  async function loadCourseState() {
    const info = readAuthToken();
    if (!info) { logMsg('❌ 尚未登录，请先登录'); return; }
    logMsg('📡 获取课程清单...');
    const courses = await loadCourseList();
    if (!courses) { logMsg('❌ 获取课程列表失败（CDN 不可用？）'); return; }
    const periods = await fetchCourseHours();
    courseData = [];
    for (const c of courses) {
      const sd = await fetchStudyRecord(c.course_id);
      const period = readPeriod(periods, c.course_id, 0);
      const sdProgress = Math.min(100, Math.max(0, Number(sd && sd.progress) || 0));
      let extInfo = null;
      try { extInfo = sd ? JSON.parse(sd.ext_info) : null; } catch (e) {  }
      const completedActs = extInfo
        ? Object.values(extInfo.activity_progress || {}).filter(function (v) { return v === 2; }).length
        : 0;
      const target = targetHours({ maxPeriod: c.max_period, phase_id: c.phase_id });
      let status = 'pending';
      if (period >= target) status = 'done';
      else if (sdProgress > 0 || period > 0) status = 'partial';
      courseData.push({
        id: c.course_id,
        title: c.title,
        maxPeriod: c.max_period,
        totalPeriod: c.total_period,
        period: period,
        sdProgress: status === 'done' ? 100 : sdProgress,
        status: status,
        completedActs: completedActs,
        totalActs: null,
        cover: c.front_cover_url,
        message: '',
        phase_id: c.phase_id
      });
    }
    const electiveCourses = courseData.filter(function (cs) { return cs.phase_id; });
    if (electiveCourses.some(function (cs) { return cs.period >= ELECTIVE_TARGET_HOURS; })) {
      electiveCourses.forEach(function (cs) {
        cs.status = 'done';
        cs.sdProgress = 100;
        cs.message = cs.period >= ELECTIVE_TARGET_HOURS
          ? '选修组已达 ' + ELECTIVE_TARGET_HOURS + 'h'
          : '选修组已完成，跳过';
      });
    }
    logMsg('✅ 已获取 ' + courseData.length + ' 门课程');
    refreshPanel();
  }
  async function startAutoLearn() {
    if (busy) return;
    busy = true;
    aborted = false;
    refreshPanel();
    let processed = 0, skipped = 0, failed = 0;
    try {
      const info = readAuthToken();
      if (!info) { logMsg('❌ 无登录态'); return; }
      if (courseData.length === 0) await loadCourseState();
      const runCourse = async function (cs, i, targetOverride) {
        if (aborted) return;
        const target = targetOverride || targetHours(cs);
        const plannedTotal = COURSE_INJECTION_COUNTS.get(cs.title);
        if (!plannedTotal) {
          cs.status = 'error';
          cs.message = '⚠️ 未配置注入数量';
          failed++;
          refreshPanel();
          return;
        }
        if (cs.period >= target) {
          cs.status = 'done';
          cs.sdProgress = 100;
          cs.message = '已达 ' + target + 'h，跳过';
          skipped++;
          refreshPanel();
          return;
        }
        cs.status = 'busy';
        cs.message = '请稍候';
        refreshPanel();
        const courseInfo = await loadCourseInfo(cs.id);
        if (!courseInfo || !courseInfo.course_detail || !courseInfo.course_detail.activity_set_id) {
          cs.status = 'error';
          cs.message = '⚠️ 课程信息获取失败';
          failed++;
          refreshPanel();
          return;
        }
        const fulls = await loadActivityTree(courseInfo.course_detail.activity_set_id);
        if (!fulls) {
          cs.status = 'error';
          cs.message = '⚠️ 资源树获取失败';
          failed++;
          refreshPanel();
          return;
        }
        const activities = parseActivities(fulls);
        cs.totalActs = activities.length;
        const totalRes = activities.reduce(function (s, a) { return s + a.resources.length; }, 0);
