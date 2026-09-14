// ==UserScript==
// @name         智慧中小学秒刷!!完全免费一键完成!!国家中小学智慧教育平台·2026暑期教师研修·秒刷学习助手
// @namespace    https://basic.smartedu.cn/
// @version      1.2.2
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

  const QR_WECHAT = 'https://raw.githubusercontent.com/C3H3-AI/smartedu-study-helper/master/sponsor/wechat.jpg';
  const QR_ALIPAY = 'https://raw.githubusercontent.com/C3H3-AI/smartedu-study-helper/master/sponsor/alipay.jpg';


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
        logMsg('📚 [' + (i + 1) + '/' + courseData.length + '] ' + cs.title +
          ' — 目标 ' + target + 'h, ' + activities.length + ' 活动, ' + totalRes + ' 资源');

        const existingSD = await fetchStudyRecord(cs.id);
        if (existingSD === undefined) {
          cs.status = 'error';
          cs.message = '⚠️ 读取原学习记录失败，未执行写入';
          failed++;
          refreshPanel();
          return;
        }
        let existingExtInfo = null;
        let topicType = cs.id;
        if (existingSD) {
          try { existingExtInfo = JSON.parse(existingSD.ext_info); } catch (e) {  }
          topicType = existingSD.topic_type || cs.id;
        }
        let currentExtInfo = existingExtInfo || {};
        let activitiesToProcess = activities.filter(function (act) {
          return !currentExtInfo.activity_progress || currentExtInfo.activity_progress[act.activity_id] !== 2;
        });
        const alreadyCompleted = activities.length - activitiesToProcess.length;
        const remainingCount = Math.max(0, plannedTotal - alreadyCompleted);
        activitiesToProcess = activitiesToProcess.slice(0, remainingCount);
        const batchSize = Math.max(1, activitiesToProcess.length);
        let courseFailed = false;
        let reachedTarget = false;

        for (let j = 0; j < activitiesToProcess.length; j += batchSize) {
          if (aborted) break;
          const batch = activitiesToProcess.slice(j, j + batchSize);
          cs.message = '请稍候';
          refreshPanel();

          const playbackResults = await Promise.all(batch.flatMap(function (act) {
            return act.resources.filter(function (res) { return res.duration > 0; }).map(function (res) {
              return savePlaybackPos(res.resource_id, res.duration + 1);
            });
          }));
          const playbackOk = playbackResults.every(function (ok) { return ok; });
          const built = buildProgressInfo(
            { front_cover_url: cs.cover }, activities, batch, currentExtInfo
          );
          const progress = built.progress;
          const extInfoRaw = built.raw;
          const sdOk = await pushStudyRecord(cs.id, cs.title, cs.cover, topicType, progress, extInfoRaw);
          await delay(400);
          const beginOk = await syncProgress('begin', cs.id, cs.title, topicType, progress, extInfoRaw);
          await delay(250);
          const asyncOk = await syncProgress('async', cs.id, cs.title, topicType, progress, extInfoRaw);
          await delay(400);
          const finalOk = await pushStudyRecord(cs.id, cs.title, cs.cover, topicType, progress, extInfoRaw);

          if (!playbackOk || !sdOk || !beginOk || !asyncOk || !finalOk) {
            cs.status = 'error';
            cs.message = '❌ 第 ' + (Math.floor(j / batchSize) + 1) + ' 批上报失败';
            failed++;
            courseFailed = true;
            logMsg('❌ ' + cs.title + ' 上报失败');
            break;
          }

          currentExtInfo = extInfoRaw;
          cs.sdProgress = progress;
          cs.completedActs = activities.filter(function (item) {
            return currentExtInfo.activity_progress[item.activity_id] === 2;
          }).length;
          cs.message = '请稍候';
          refreshPanel();
          cs.period = await waitForCourseHours(cs.id, cs.period, target);

          if (cs.period >= target) {
            cs.status = 'done';
            cs.sdProgress = 100;
            cs.message = '✅ 已达 ' + target + 'h';
            processed++;
            reachedTarget = true;
            logMsg('✅ ' + cs.title + ' 已达 ' + target + 'h');
            break;
          }
        }

        if (aborted) return;
        if (!courseFailed && !reachedTarget) {
          cs.status = 'error';
          cs.message = '⚠️ 可用视频已完成，当前 ' + cs.period.toFixed(1) + '/' + target + 'h';
          failed++;
          logMsg('⚠️ ' + cs.title + ' 学时未达标');
        }
        refreshPanel();
        await delay(500);
      };

      const requiredCourses = courseData.filter(function (cs) { return !cs.phase_id; });
      const electiveCourses = courseData.filter(function (cs) { return cs.phase_id; });
      const completedElective = electiveCourses.find(function (cs) {
        return cs.period >= ELECTIVE_TARGET_HOURS;
      });
      let selectedElective = null;
      if (completedElective) {
        electiveCourses.forEach(function (cs) {
          cs.status = 'done';
          cs.sdProgress = 100;
          cs.message = cs === completedElective
            ? '选修组已达 ' + ELECTIVE_TARGET_HOURS + 'h'
            : '选修组已完成，跳过';
        });
        skipped += electiveCourses.length;
        logMsg('✅ 学科教学能力提升已达 ' + ELECTIVE_TARGET_HOURS + 'h，全部子板块跳过');
      } else if (electiveCourses.length > 0) {
        selectedElective = electiveCourses.find(function (cs) {
          return cs.title === ELECTIVE_COURSE_TITLE;
        });
        if (selectedElective) {
          logMsg('🎯 学科教学能力提升只处理：' + selectedElective.title);
        } else {
          failed++;
          logMsg('❌ 未找到选修课程：' + ELECTIVE_COURSE_TITLE);
        }
      }

      const scheduledCourses = requiredCourses.concat(selectedElective ? [selectedElective] : []);
      const courseRuns = scheduledCourses.map(function (cs) {
        return runCourse(
          cs,
          courseData.indexOf(cs),
          cs === selectedElective ? ELECTIVE_TARGET_HOURS : undefined
        );
      });
      const courseResults = await Promise.allSettled(courseRuns);
      courseResults.forEach(function (result, index) {
        if (result.status === 'rejected') {
          scheduledCourses[index].status = 'error';
          scheduledCourses[index].message = '❌ 运行异常';
          failed++;
          logMsg('❌ ' + scheduledCourses[index].title + ' 运行异常: ' + result.reason.message);
        }
      });

      if (!aborted && selectedElective && selectedElective.period >= ELECTIVE_TARGET_HOURS) {
        electiveCourses.forEach(function (cs) {
          if (cs === selectedElective) return;
          cs.status = 'done';
          cs.sdProgress = 100;
          cs.message = '选修组已完成，跳过';
          skipped++;
        });
      }

      logMsg('📡 同步最终状态...');
      const finalPeriods = await fetchCourseHours();
      for (const cs of courseData) {
        cs.period = Math.max(cs.period, readPeriod(finalPeriods, cs.id, cs.period));
        if (cs.period >= targetHours(cs)) {
          cs.status = 'done';
          cs.sdProgress = 100;
        } else {
          const sd = await fetchStudyRecord(cs.id);
          if (sd) cs.sdProgress = Math.min(100, Math.max(0, Number(sd.progress) || cs.sdProgress));
        }
      }
      const finalElectiveDone = courseData.find(function (cs) {
        return cs.phase_id && cs.period >= ELECTIVE_TARGET_HOURS;
      });
      if (finalElectiveDone) {
        courseData.filter(function (cs) { return cs.phase_id; }).forEach(function (cs) {
          cs.status = 'done';
          cs.sdProgress = 100;
          cs.message = cs === finalElectiveDone
            ? '选修组已达 ' + ELECTIVE_TARGET_HOURS + 'h'
            : '选修组已完成，跳过';
        });
      }
      logMsg('🏁 刷新一下网页就好啦');
    } catch (e) {
      logMsg('❌ 运行异常: ' + e.message);
    } finally {
      busy = false;
      refreshPanel();
    }
  }

  function stopAutoLearn() {
    aborted = true;
    logMsg('⏹ 正在停止...');
    refreshPanel();
  }

  function delay(ms) {
    return new Promise(function (r) { setTimeout(r, ms); });
  }

  const PANEL_CSS = [
    /* ── design tokens（双选择器：面板 + 弹窗共享） ── */
    '#seSafePanel,#sspModal{--bg:#0B1220;--surface:#101A2E;--surface2:#15213A;',
    '--border:rgba(148,163,184,.16);--border-soft:rgba(148,163,184,.1);',
    '--tx-hi:#E8EEF9;--tx-mid:#A8B6CE;--tx-low:#7588A8;',
    '--accent:#6366F1;--accent-deep:#4F46E5;',
    '--ok:#34D399;--info:#60A5FA;--warn:#FBBF24;--bad:#F87171;',
    '--ease:cubic-bezier(.16,1,.3,1);}',
    /* ── 外壳：玻璃双层嵌套 + 内顶高光 + 着色阴影（无纯黑） ── */
    '#seSafePanel{position:fixed;left:16px;top:80px;width:440px;max-height:90vh;display:flex;flex-direction:row;',
    'z-index:2147483647;overflow:hidden;border-radius:18px;',
    'background:linear-gradient(180deg,rgba(22,32,56,.94),rgba(11,18,32,.97));',
    'border:1px solid rgba(148,163,184,.22);',
    'box-shadow:0 24px 60px -16px rgba(2,6,23,.75),0 10px 28px -12px rgba(2,6,23,.55),',
    'inset 0 1px 0 rgba(255,255,255,.08);',
    'color:var(--tx-hi);backdrop-filter:blur(18px) saturate(1.4);-webkit-backdrop-filter:blur(18px) saturate(1.4);',
    'font:13px/1.55 -apple-system,BlinkMacSystemFont,"SF Pro SC","PingFang SC","Segoe UI","Microsoft YaHei",sans-serif;',
    'animation:sspIn .45s var(--ease) both;}',
    '@media (prefers-reduced-transparency:reduce){#seSafePanel{backdrop-filter:none;-webkit-backdrop-filter:none;}}',
    '@media (prefers-reduced-motion:reduce){#seSafePanel{animation:none;}#seSafePanel .ssp-dot.busy{animation:none;}}',
    /* ── 左侧收款栏：内嵌面板质感 ── */
    '#seSafePanel .ssp-side{width:128px;flex-shrink:0;display:flex;flex-direction:column;align-items:center;',
    'justify-content:center;gap:7px;padding:12px 10px;',
    'background:linear-gradient(180deg,rgba(255,255,255,.05),rgba(255,255,255,.02));',
    'border-right:1px solid var(--border-soft);box-shadow:inset -1px 0 0 rgba(255,255,255,.04);}',
    '#seSafePanel .ssp-side img{width:100px;height:100px;border-radius:12px;background:#fff;padding:6px;',
    'object-fit:contain;box-shadow:0 8px 20px -6px rgba(2,6,23,.6),inset 0 1px 0 rgba(255,255,255,.9);}',
    '#seSafePanel .ssp-side-label{font-size:10px;font-weight:600;color:var(--tx-mid);letter-spacing:.06em;}',
    '#seSafePanel .ssp-side-text{font-size:10px;color:var(--tx-low);text-align:center;line-height:1.55;margin-top:2px;}',
    /* ── 主列 ── */
    '#seSafePanel .ssp-main{flex:1;min-width:0;display:flex;flex-direction:column;}',
    '#seSafePanel *{box-sizing:border-box;margin:0;padding:0;}',
    '#seSafePanel.isCollapsed{width:50px;height:50px;border-radius:50%;cursor:pointer;',
    'background:linear-gradient(160deg,rgba(79,70,229,.92),rgba(109,40,217,.92));',
    'border:1px solid rgba(148,163,184,.3);}',
    '#seSafePanel.isCollapsed>*{display:none;}',
    /* ── 头部：品牌渐变 + 内顶高光 ── */
    '#seSafePanel .ssp-head{display:flex;align-items:center;gap:10px;padding:11px 14px;cursor:move;user-select:none;',
    'background:linear-gradient(120deg,var(--accent-deep),#6D28D9);',
    'box-shadow:inset 0 1px 0 rgba(255,255,255,.14),0 1px 0 rgba(2,6,23,.35);}',
    '#seSafePanel .ssp-title{font-weight:700;font-size:13.5px;letter-spacing:.01em;white-space:nowrap;overflow:hidden;',
    'text-shadow:0 1px 2px rgba(2,6,23,.35);}',
    '#seSafePanel .ssp-sub{font-size:10px;opacity:.78;letter-spacing:.02em;margin-top:1px;}',
    '#seSafePanel .ssp-fold{border:0;background:rgba(255,255,255,.16);color:#fff;border-radius:999px;',
    'width:24px;height:24px;cursor:pointer;font-size:12px;line-height:1;flex-shrink:0;',
    'transition:background .2s var(--ease),transform .2s var(--ease);}',
    '#seSafePanel .ssp-fold:hover{background:rgba(255,255,255,.3);}',
    '#seSafePanel .ssp-fold:active{transform:scale(.92);}',
    /* ── 操作按钮：胶囊 + 按压物理 + 焦点环 ── */
    '#seSafePanel .ssp-actions{display:flex;gap:8px;padding:10px 12px;border-bottom:1px solid var(--border-soft);}',
    '#seSafePanel .ssp-btn{flex:1;padding:8px 0;border:0;border-radius:999px;cursor:pointer;font-size:12.5px;font-weight:600;',
    'letter-spacing:.02em;',
    'transition:transform .18s var(--ease),filter .18s var(--ease),background .18s var(--ease),box-shadow .18s var(--ease);}',
    '#seSafePanel .ssp-btn:active{transform:scale(.97);}',
    '#seSafePanel .ssp-btn:focus-visible,#seSafePanel .ssp-fold:focus-visible,#seSafePanel .ssp-head-btn:focus-visible',
    '{outline:2px solid var(--info);outline-offset:2px;}',
    '#seSafePanel .ssp-start{background:linear-gradient(180deg,#6366F1,#4F46E5);color:#fff;',
    'box-shadow:0 6px 16px -6px rgba(79,70,229,.55),inset 0 1px 0 rgba(255,255,255,.18);}',
    '#seSafePanel .ssp-start:hover{filter:brightness(1.08);',
    'box-shadow:0 8px 20px -6px rgba(79,70,229,.65),inset 0 1px 0 rgba(255,255,255,.18);}',
    '#seSafePanel .ssp-start:disabled{opacity:.45;cursor:not-allowed;filter:none;box-shadow:none;}',
    '#seSafePanel .ssp-stop{background:rgba(248,113,113,.14);color:#FDA4AF;',
    'box-shadow:inset 0 0 0 1px rgba(248,113,113,.28);}',
    '#seSafePanel .ssp-stop:hover{background:rgba(248,113,113,.22);}',
    '#seSafePanel .ssp-refresh{background:rgba(255,255,255,.07);color:var(--tx-mid);',
    'box-shadow:inset 0 0 0 1px rgba(148,163,184,.22);}',
    '#seSafePanel .ssp-refresh:hover{background:rgba(255,255,255,.12);color:var(--tx-hi);}',
    /* ── 统计卡：内嵌高光微卡 ── */
    '#seSafePanel .ssp-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;padding:12px 12px 10px;',
    'border-bottom:1px solid var(--border-soft);}',
    '#seSafePanel .ssp-stat{text-align:center;border-radius:14px;padding:9px 4px 8px;',
    'background:linear-gradient(180deg,rgba(255,255,255,.05),rgba(255,255,255,.015));',
    'box-shadow:inset 0 1px 0 rgba(255,255,255,.06),inset 0 0 0 1px rgba(148,163,184,.09);}',
    '#seSafePanel .ssp-stat b{display:block;font-size:18px;font-weight:700;letter-spacing:-.01em;',
    'font-variant-numeric:tabular-nums;}',
    '#seSafePanel .ssp-stat span{font-size:10px;color:var(--tx-low);margin-top:2px;display:block;letter-spacing:.04em;}',
    /* ── 课程列表：细线分隔行 + 胶囊进度条 ── */
    '#seSafePanel .ssp-body{overflow-y:auto;min-height:0;scrollbar-width:thin;',
    'scrollbar-color:rgba(148,163,184,.25) transparent;}',
    '#seSafePanel .ssp-body::-webkit-scrollbar{width:5px;}',
    '#seSafePanel .ssp-body::-webkit-scrollbar-thumb{background:rgba(148,163,184,.25);border-radius:4px;}',
    '#seSafePanel .ssp-course{padding:9px 14px;border-bottom:1px solid var(--border-soft);',
    'transition:background .18s var(--ease);}',
    '#seSafePanel .ssp-course:last-child{border-bottom:0;}',
    '#seSafePanel .ssp-course:hover{background:rgba(255,255,255,.025);}',
    '#seSafePanel .ssp-row{display:flex;align-items:center;gap:8px;}',
    '#seSafePanel .ssp-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0;',
    'box-shadow:inset 0 1px 1px rgba(255,255,255,.25);}',
    '#seSafePanel .ssp-dot.done{background:var(--ok);}',
    '#seSafePanel .ssp-dot.busy{background:var(--info);animation:sspPulse 1.3s var(--ease) infinite;}',
    '#seSafePanel .ssp-dot.partial{background:var(--warn);}',
    '#seSafePanel .ssp-dot.pending{background:#3E4E6B;}',
    '#seSafePanel .ssp-dot.error{background:var(--bad);}',
    '#seSafePanel .ssp-name{flex:1;font-size:12px;font-weight:500;color:var(--tx-hi);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
    '#seSafePanel .ssp-pct{font-size:12px;font-weight:700;min-width:38px;text-align:right;font-variant-numeric:tabular-nums;}',
    '#seSafePanel .ssp-bar{height:3px;background:rgba(148,163,184,.14);border-radius:999px;margin-top:6px;overflow:hidden;',
    'box-shadow:inset 0 1px 1px rgba(2,6,23,.4);}',
    '#seSafePanel .ssp-fill{height:100%;border-radius:999px;transition:width .5s var(--ease);}',
    '#seSafePanel .ssp-msg{font-size:10px;color:var(--accent);margin-top:4px;opacity:.9;}',
    '#seSafePanel .ssp-meta{display:flex;gap:12px;padding-left:16px;font-size:10px;color:var(--tx-low);margin-top:3px;}',
    /* ── 日志：标题 + 等宽内容 ── */
    '#seSafePanel .ssp-logs{border-top:1px solid var(--border-soft);max-height:112px;',
    'display:flex;flex-direction:column;}',
    '#seSafePanel .ssp-log-title{padding:8px 14px 4px;font-size:10px;font-weight:600;color:var(--tx-low);',
    'letter-spacing:.12em;text-transform:uppercase;}',
    '#seSafePanel .ssp-log-content{flex:1;min-height:0;overflow-y:auto;padding:2px 14px 10px;font-size:10px;',
    'font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;line-height:1.7;}',
    '#seSafePanel .ssp-log-line{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--tx-mid);}',
    /* ── 头部圆形按钮 ── */
    '#seSafePanel .ssp-head-btn{border:0;background:rgba(255,255,255,.14);color:#fff;border-radius:999px;',
    'width:28px;height:28px;cursor:pointer;font-size:13px;line-height:1;flex-shrink:0;margin-left:2px;',
    'transition:background .2s var(--ease),transform .2s var(--ease);}',
    '#seSafePanel .ssp-head-btn:hover{background:rgba(255,255,255,.28);}',
    '#seSafePanel .ssp-head-btn:active{transform:scale(.9);}',
    /* ── 弹窗：玻璃遮罩 + 卡片内高光 ── */
    '#sspModal{position:fixed;inset:0;z-index:2147483646;background:rgba(2,6,23,.72);',
    'backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);',
    'display:flex;align-items:center;justify-content:center;animation:sspFade .25s var(--ease) both;}',
    '#sspModal .ssp-modal-card{background:linear-gradient(180deg,#141F36,#0D1628);',
    'border:1px solid rgba(148,163,184,.22);border-radius:18px;',
    'width:min(560px,92vw);max-height:85vh;overflow-y:auto;padding:22px;color:var(--tx-hi);',
    'font:13px/1.6 -apple-system,BlinkMacSystemFont,"SF Pro SC","PingFang SC","Segoe UI","Microsoft YaHei",sans-serif;',
    'box-shadow:0 28px 70px -18px rgba(2,6,23,.8),inset 0 1px 0 rgba(255,255,255,.08);}',
    '#sspModal .ssp-modal-card img{width:170px;height:170px;border-radius:14px;background:#fff;padding:8px;',
    'box-shadow:0 10px 24px -8px rgba(2,6,23,.6);}',
    '#sspModal .ssp-modal-close{border:0;background:rgba(148,163,184,.14);color:var(--tx-hi);border-radius:999px;',
    'padding:8px 22px;cursor:pointer;font-size:12px;margin-top:16px;',
    'transition:background .2s var(--ease),transform .2s var(--ease);}',
    '#sspModal .ssp-modal-close:hover{background:rgba(148,163,184,.26);}',
    '#sspModal .ssp-modal-close:active{transform:scale(.97);}',
    '@keyframes sspPulse{0%,100%{opacity:1}50%{opacity:.35}}',
    '@keyframes sspIn{from{opacity:0;transform:translateY(10px) scale(.985)}to{opacity:1;transform:none}}',
    '@keyframes sspFade{from{opacity:0}to{opacity:1}}'
  ].join('');

  function statusText(s) {
    return { done: '✅ 学完', busy: '🔄 执行中', partial: '🟡 部分完成', pending: '⏳ 未开始', error: '❌ 出错' }[s] || s;
  }

  function buildPanel() {
    const styleEl = document.createElement('style');
    styleEl.textContent = PANEL_CSS;
    document.head.appendChild(styleEl);

    panelNode = document.createElement('div');
    panelNode.id = 'seSafePanel';
    panelNode.innerHTML = buildQrSideHtml() +
      '<div class="ssp-main">' +
        '<div class="ssp-head">' +
          '<div style="flex:1;min-width:0">' +
            '<div class="ssp-title">📘 研修助手 · 安全版</div>' +
            '<div class="ssp-sub">零外链 · 白名单 · 可审计</div>' +
          '</div>' +
          '<button class="ssp-head-btn" id="sspCheckBtn" title="只读自检（仅GET，验证token与签名链路）">🔍</button>' +
          '<button class="ssp-fold" title="折叠">—</button>' +
        '</div>' +
        '<div class="ssp-actions">' +
          '<button class="ssp-btn ssp-refresh" id="sspRefresh">🔄 刷新</button>' +
          '<button class="ssp-btn ssp-start" id="sspStart">🚀 开始学习</button>' +
          '<button class="ssp-btn ssp-stop" id="sspStop" style="display:none">⏹ 停止</button>' +
        '</div>' +
        '<div class="ssp-stats"></div>' +
        '<div class="ssp-body"></div>' +
        '<div class="ssp-logs">' +
          '<div class="ssp-log-title">运行日志</div>' +
          '<div class="ssp-log-content"></div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(panelNode);
    loadPanelPos();

    panelNode.querySelector('.ssp-fold').addEventListener('click', function (e) {
      e.stopPropagation();
      togglePanel();
    });
    panelNode.addEventListener('click', function () { if (isCollapsed) togglePanel(); });
    panelNode.querySelector('#sspRefresh').addEventListener('click', loadCourseState);
    panelNode.querySelector('#sspStart').addEventListener('click', startAutoLearn);
    panelNode.querySelector('#sspStop').addEventListener('click', stopAutoLearn);
    panelNode.querySelector('#sspCheckBtn').addEventListener('click', function (e) { e.stopPropagation(); runHealthCheck(); });
    enableDrag();
  }

  function refreshPanel() {
    if (!panelNode) buildPanel();
    const done = courseData.filter(function (c) { return c.status === 'done'; }).length;
    const total = courseData.length;
    const hours = courseData.reduce(function (s, c) { return s + (Number(c.period) || 0); }, 0);

    const statsEl = panelNode.querySelector('.ssp-stats');
    if (statsEl) {
      statsEl.innerHTML =
        '<div class="ssp-stat"><b style="color:#34d399">' + done + '/' + total + '</b><span>课程完成</span></div>' +
        '<div class="ssp-stat"><b style="color:#60a5fa">' + hours.toFixed(1) + '</b><span>总学时(h)</span></div>' +
        '<div class="ssp-stat"><b style="color:#fbbf24">' + (total > 0 ? Math.round(done / total * 100) : 0) + '%</b><span>完成率</span></div>';
    }

    const listEl = panelNode.querySelector('.ssp-body');
    if (listEl) {
      listEl.innerHTML = courseData.map(function (cs) {
        const pct = Math.min(100, Math.max(0, Number(cs.sdProgress) || 0));
        const fillBg = pct >= 100
          ? 'linear-gradient(90deg,#34d399,#10b981)'
          : (pct > 0 ? 'linear-gradient(90deg,#60a5fa,#3b82f6)' : 'linear-gradient(90deg,#fbbf24,#f59e0b)');
        const acts = cs.totalActs !== null
          ? (cs.completedActs || 0) + '/' + cs.totalActs + '节'
          : (cs.completedActs || 0) + '节';
        return '<div class="ssp-course">' +
          '<div class="ssp-row">' +
            '<span class="ssp-dot ' + cs.status + '"></span>' +
            '<span class="ssp-name" title="' + esc(cs.title) + '">' + esc(cs.title) + '</span>' +
            '<span class="ssp-pct" style="color:' + (pct >= 100 ? '#34d399' : '#E8EEF9') + '">' + pct + '%</span>' +
          '</div>' +
          '<div class="ssp-meta">' +
            '<span>📚 ' + esc(acts) + '</span>' +
            '<span>⏱ ' + cs.period.toFixed(1) + 'h</span>' +
            '<span>' + statusText(cs.status) + '</span>' +
          '</div>' +
          (cs.message ? '<div class="ssp-msg">' + esc(cs.message) + '</div>' : '') +
          '<div class="ssp-bar"><div class="ssp-fill" style="width:' + Math.min(pct, 100) + '%;background:' + fillBg + '"></div></div>' +
        '</div>';
      }).join('');
    }

    const logsEl = panelNode.querySelector('.ssp-log-content');
    if (logsEl) {
      logsEl.innerHTML = logs.slice(0, 30).map(function (l) {
        return '<div class="ssp-log-line">' + esc(l) + '</div>';
      }).join('');
    }

    const btnStart = panelNode.querySelector('#sspStart');
    const btnStop = panelNode.querySelector('#sspStop');
    if (btnStart) btnStart.disabled = busy;
    if (btnStop) btnStop.style.display = busy ? '' : 'none';
  }

  function togglePanel() {
    isCollapsed = !isCollapsed;
    panelNode.classList.toggle('isCollapsed', isCollapsed);
    panelNode.querySelector('.ssp-fold').textContent = isCollapsed ? '+' : '—';
  }

  function enableDrag() {
    const head = panelNode.querySelector('.ssp-head');
    let dragging = false, sx = 0, sy = 0, sl = 0, st = 0;
    head.addEventListener('mousedown', function (e) {
      if (e.target.closest('.ssp-fold')) return;
      dragging = true;
      const r = panelNode.getBoundingClientRect();
      sx = e.clientX; sy = e.clientY; sl = r.left; st = r.top;
      document.body.style.userSelect = 'none';
      e.preventDefault();
    });
    document.addEventListener('mousemove', function (e) {
      if (!dragging) return;
      let nl = sl + (e.clientX - sx);
      let nt = st + (e.clientY - sy);
      nl = Math.max(0, Math.min(window.innerWidth - panelNode.offsetWidth, nl));
      nt = Math.max(0, Math.min(window.innerHeight - 50, nt));
      panelNode.style.left = nl + 'px';
      panelNode.style.top = nt + 'px';
    });
    document.addEventListener('mouseup', function () {
      if (!dragging) return;
      dragging = false;
      document.body.style.userSelect = '';
      persistPanelPos();
    });
  }

  function persistPanelPos() {
    try {
      const r = panelNode.getBoundingClientRect();
      localStorage.setItem(PANEL_POS_KEY, JSON.stringify({ left: r.left, top: r.top }));
    } catch (e) {  }
  }

  function loadPanelPos() {
    try {
      const p = JSON.parse(localStorage.getItem(PANEL_POS_KEY));
      if (p && typeof p.left === 'number') {
        panelNode.style.left = p.left + 'px';
        panelNode.style.top = p.top + 'px';
      }
    } catch (e) {  }
  }

  const checkLog = [];
  function rec(name, ok, detail) {
    checkLog.push({ name: name, ok: ok, detail: detail });
    console.log((ok ? '[自检 OK] ' : '[自检 X] ') + name + ' ' + detail);
  }

  async function checkCdn() {
    let okCount = 0, first = null;
    for (const h of CDN_POOL) {
      try {
        const r = await fetch('https://' + h + '.ykt.cbern.com.cn/teach/api_static/trains/2026jjsqpx/train_courses.json');
        if (r.ok) {
          okCount++;
          if (!first) first = await r.json();
        }
      } catch (e) {  }
    }
    rec('CDN 课程列表', okCount >= 1, okCount + '/4 主机可用, 课程数=' + (first ? first.length : '?'));
    return first;
  }

  async function checkStudyDetails(courseId, userId) {
    const url = 'https://x-study-record-api.ykt.eduyun.cn/v1/study_details/' + courseId + '/' + userId;
    try {
      const r = await safeFetch(url, { headers: await makeAuthHeaders(url, 'GET') });
      const txt = await r.text();
      rec('GET study_details (签名验证)', r.ok, 'HTTP ' + r.status + ' ' + txt.slice(0, 80).replace(/\n/g, ' '));
    } catch (e) {
      rec('GET study_details (签名验证)', false, '异常: ' + e.message);
    }
  }

  async function checkPeriods(userId) {
    const url = 'https://elearning-train-api.ykt.eduyun.cn/v1/users/' + userId + '/trains/' + TRAINING_ID + '/courses_period/actions/list';
    try {
      const r = await safeFetch(url, { headers: await makeAuthHeaders(url, 'GET') });
      const txt = await r.text();
      let n = '?';
      try { if (r.ok && txt) n = Object.keys(JSON.parse(txt)).length; } catch (e) {  }
      rec('GET 学时列表 (签名验证)', r.ok, 'HTTP ' + r.status + ' 课程数=' + n);
    } catch (e) {
      rec('GET 学时列表 (签名验证)', false, '异常: ' + e.message);
    }
  }

  async function runHealthCheck() {
    checkLog.length = 0;
    const info = readAuthToken();
    if (!info) {
      rec('读取 token', false, '未找到 ND_UC_AUTH-* 键，请先登录平台');
      renderCheckDialogMsg();
      return;
    }
    rec('读取 token', true, 'userId: ' + info.userId);
    rec('token 字段完整', !!(info.token.mac_key && info.token.access_token), 'mac_key=' + (info.token.mac_key || '').slice(0, 8) + '..., access_token=' + (info.token.access_token || '').slice(0, 8) + '...');

    const courses = await checkCdn();
    if (courses && courses.length) {
      const first = courses[0];
      rec('课程列表字段', !!first.course_id, '第一门: ' + first.title);
      await checkStudyDetails(first.course_id, info.userId);
      await checkPeriods(info.userId);
    } else {
      rec('课程列表', false, 'CDN 全失败');
    }
    renderCheckDialogMsg();
  }

  function renderCheckDialogMsg() {
    const totalOk = checkLog.filter(function (r) { return r.ok; }).length;
    const listHtml = checkLog.map(function (r) {
      const c = r.ok ? '#4ade80' : '#f87171';
      return '<div style="color:' + c + '">' + (r.ok ? '✅' : '❌') + ' ' + esc(r.name) +
        '<div style="color:#94a3b8;font-size:11px;padding-left:20px;margin-bottom:6px">' + esc(r.detail) + '</div></div>';
    }).join('');
    showDialogMsg(
      '🔍 只读自检结果',
      '<div style="font:12px/1.6 ui-monospace,Menlo,monospace">' + listHtml + '</div>' +
      '<div style="border-top:1px solid #334155;margin-top:12px;padding-top:10px;color:#fbbf24;font-weight:700">' +
      '结论: ' + totalOk + '/' + checkLog.length + ' 项通过（仅GET，未写入任何数据）</div>'
    );
  }

  function buildQrSideHtml() {
    const hasQr = QR_ALIPAY || QR_WECHAT;
    let inner = '';
    if (!hasQr) {
      inner = '<div style="color:#64748b;font-size:11px;text-align:center;line-height:1.6;padding:10px 0">' +
        '🙏 感谢支持<br>作者尚未嵌入收款码</div>';
    } else {
      if (QR_ALIPAY) {
        inner += '<img src="' + QR_ALIPAY + '" alt="支付宝" title="支付宝">' +
          '<div class="ssp-side-label">支付宝</div>';
      }
      if (QR_WECHAT) {
        inner += '<img src="' + QR_WECHAT + '" alt="微信" title="微信">' +
          '<div class="ssp-side-label">微信</div>';
      }
    }
    return '<div class="ssp-side">' + inner +
      '<div class="ssp-side-text">🍵 如果脚本帮到您<br>可以请作者喝杯茶呀</div>' +
      '</div>';
  }

  function showDialogMsg(title, bodyHtml) {
    const old = document.getElementById('sspModal');
    if (old) old.remove();
    const m = document.createElement('div');
    m.id = 'sspModal';
    m.innerHTML = '<div class="ssp-modal-card">' +
      '<div style="font-weight:700;font-size:14px;margin-bottom:12px">' + esc(title) + '</div>' +
      bodyHtml +
      '<div style="text-align:center"><button class="ssp-modal-close">关闭</button></div>' +
      '</div>';
    m.querySelector('.ssp-modal-card').addEventListener('click', function (e) { e.stopPropagation(); });
    m.querySelector('.ssp-modal-close').addEventListener('click', function () { m.remove(); });
    m.addEventListener('click', function () { m.remove(); });
    document.body.appendChild(m);
  }

  function init() {
    if (!readAuthToken()) {
      console.log('[研修助手] 尚未登录，5秒后重试...');
      setTimeout(init, 5000);
      return;
    }
    logMsg('🎓 已就绪');
    loadCourseState();
  }

  if (document.readyState === 'complete') setTimeout(init, 1500);
  else window.addEventListener('load', function () { setTimeout(init, 1500); });
})();
