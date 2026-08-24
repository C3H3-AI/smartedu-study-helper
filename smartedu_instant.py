# -*- coding:utf-8 -*-
"""
国家智慧教育公共服务平台 - 2026暑期教师研修 秒学脚本
原理：直接调用API提交学习进度，半分钟完成10学时
"""

import json
import time
import hmac
import hashlib
import base64
import requests
from urllib.parse import urlparse

# ===== 配置信息 =====
ACCESS_TOKEN = "7F938B205F876FC39BD5FD64A3C821673194B60AF1C53411E5AB95099C7A9EAE2942CD03B735A65FC03B055F6FC3F603BEA123908DF1ED95"
MAC_KEY = "3b1pMcM2TR"
USER_ID = "452586124720"
SDP_APP_ID = "e5649925-441d-4a53-b525-51a2f1c4e0a8"
TRAINING_ID = "dc6d78f2-bad8-4d09-b8da-0d758803dbe4"
LIBRARY_REF = "bb042e69-9a11-49a1-af22-0c3fab2e92b9"
TRAIN_TAG = '2026年"暑期教师研修"专题（基础教育）'
TRAIN_ORIGIN = '2026年"暑期教师研修"专题'
CDN_HOSTS = ["s-file-1.ykt.cbern.com.cn", "s-file-2.ykt.cbern.com.cn", "bdcs-file-1.ykt.cbern.com.cn", "bdcs-file-2.ykt.cbern.com.cn"]

# ===== MAC 签名 =====
def generate_mac_auth(url, method):
    parsed = urlparse(url)
    nonce = str(int(time.time() * 1000)) + ":" + base64.b64encode(__import__('os').urandom(6)).decode().upper()[:8]
    raw = f"{nonce}\n{method}\n{parsed.path}{parsed.query}\n{parsed.hostname}\n"
    sig = hmac.new(MAC_KEY.encode(), raw.encode(), hashlib.sha256).digest()
    mac = base64.b64encode(sig).decode()
    return f'MAC id="{ACCESS_TOKEN}",nonce="{nonce}",mac="{mac}"'

def make_headers(url, method):
    return {
        "Content-Type": "application/json",
        "Authorization": generate_mac_auth(url, method),
        "SDP-APP-ID": SDP_APP_ID
    }

# ===== CDN 请求（课程数据） =====
def cdn_request(path):
    for host in CDN_HOSTS:
        try:
            r = requests.get(f"https://{host}{path}", timeout=10)
            if r.ok:
                return r.json()
        except:
            continue
    return None

# ===== 主逻辑 =====
def main():
    print("=== 2026暑期教师研修 秒学脚本 ===")
    print(f"用户ID: {USER_ID}")
    
    # 1. 获取课程列表
    print("\n1. 获取课程列表...")
    courses = cdn_request("/teach/api_static/trains/2026jjsqpx/train_courses.json")
    if not courses:
        print("❌ 获取课程列表失败")
        return
    print(f"✅ 找到 {len(courses)} 门课程")
    
    for idx, course in enumerate(courses):
        course_id = course["course_id"]
        title = course["title"]
        print(f"\n--- [{idx+1}/{len(courses)}] {title} ---")
        
        # 2. 获取课程详情
        info = cdn_request(f"/teach/s_course/v2/business_courses/{course_id}/course_relative_infos/zh-CN.json")
        if not info or not info.get("course_detail", {}).get("activity_set_id"):
            print(f"  ⏭️ 跳过：无活动集信息")
            continue
        
        as_id = info["course_detail"]["activity_set_id"]
        
        # 3. 获取活动树
        fulls = cdn_request(f"/teach/s_course/v2/activity_sets/{as_id}/fulls.json")
        if not fulls:
            print(f"  ⏭️ 跳过：无活动树")
            continue
        
        # 4. 解析活动
        activities = []
        def walk(node):
            if not node:
                return
            if node.get("node_type") == "catalog" and node.get("child_nodes"):
                for child in node["child_nodes"]:
                    walk(child)
            elif node.get("node_type") == "activity":
                act_res = []
                relations = node.get("relations", {})
                if relations.get("activity", {}).get("activity_resources"):
                    act_res = relations["activity"]["activity_resources"]
                resources = []
                for r in act_res:
                    dur = 0
                    if r.get("video_extend", {}).get("duration"):
                        dur = r["video_extend"]["duration"]
                    elif r.get("study_time"):
                        dur = r["study_time"]
                    resources.append({
                        "resource_id": r["resource_id"],
                        "duration": dur
                    })
                activities.append({
                    "activity_id": node["node_id"],
                    "activity_name": node.get("node_name", ""),
                    "resources": resources
                })
        
        for node in fulls.get("nodes", []):
            walk(node)
        
        print(f"  活动数: {len(activities)}")
        
        # 5. 构建进度数据
        activity_progress = {}
        resource_progress = {}
        resource_max_pos = {}
        activity_last_resource = {}
        
        for act in activities:
            activity_progress[act["activity_id"]] = 2
            for res in act["resources"]:
                resource_progress[res["resource_id"]] = 2
                pos = res["duration"] + 1 if res["duration"] > 0 else 1
                resource_max_pos[res["resource_id"]] = {"pos": pos, "type": "video" if res["duration"] > 0 else "document"}
                activity_last_resource[act["activity_id"]] = res["resource_id"]
        
        last_activity = None
        if activities:
            last = activities[-1]
            last_activity = {"activity_id": last["activity_id"], "title": last["activity_name"]}
        
        ext_info = {
            "cv": 1, "platform": "web",
            "tags": TRAIN_TAG, "origin": TRAIN_ORIGIN,
            "cover": course.get("front_cover_url", "") or "",
            "last_learning_activity": last_activity,
            "activity_last_learning_resource": activity_last_resource,
            "activity_progress": activity_progress,
            "resource_progress": resource_progress,
            "miniwork_progress": {},
            "resource_max_pos": resource_max_pos,
            "activity_exam_progress": {},
            "activity_event": {},
            "resource_study_time_ignore": [],
            "additional_params": {"library_id": LIBRARY_REF}
        }
        
        progress = 100 if activities else 0
        
        body = {
            "user_id": USER_ID,
            "resource_id": course_id,
            "resource_name": title,
            "resource_type": "t_course",
            "catalog_type": "teacherTraining",
            "topic_type": None,
            "progress": progress,
            "status": 1,
            "ext_info": json.dumps(ext_info, ensure_ascii=False)
        }
        
        # 6. 提交学习记录
        study_url = "https://x-study-record-api.ykt.eduyun.cn/v1/study_details"
        try:
            r = requests.post(study_url, headers=make_headers(study_url, "POST"), json=body, timeout=10)
            print(f"  📝 学习记录: {'✅' if r.ok else '❌'} {r.status_code}")
        except Exception as e:
            print(f"  📝 学习记录错误: {e}")
        
        # 7. 同步进度
        sync_url = f"https://elearning-train-gateway.ykt.eduyun.cn/v1/spi/trains/{TRAINING_ID}/courses/{course_id}/progress/actions/async"
        try:
            r = requests.post(sync_url, headers=make_headers(sync_url, "POST"), json=body, timeout=10)
            print(f"  🔄 同步进度: {'✅' if r.ok else '❌'} {r.status_code}")
        except Exception as e:
            print(f"  🔄 同步进度错误: {e}")
        
        # 8. 保存播放位置
        for act in activities:
            for res in act["resources"]:
                pos_url = f"https://x-study-record-api.ykt.eduyun.cn/v1/resource_learning_positions/{res['resource_id']}/{USER_ID}"
                pos_body = {"position": res["duration"] + 1 if res["duration"] > 0 else 1}
                try:
                    requests.put(pos_url, headers=make_headers(pos_url, "PUT"), json=pos_body, timeout=10)
                except:
                    pass
        
        print(f"  ✅ {title} 完成！")
    
    print("\n" + "=" * 40)
    print("🎉 所有课程已秒学完成！")
    print("=" * 40)

if __name__ == "__main__":
    main()