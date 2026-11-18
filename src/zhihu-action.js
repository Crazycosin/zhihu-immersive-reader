    /**
     * ============================================================================
     * 知乎写操作 API（赞同 / 反对 / 感谢 / 喜欢 / 收藏）
     *   - 同源请求，credentials:'include' 自动带 z_c0
     *   - 必须手动加 x-xsrftoken（= cookie 里的 _xsrf）
     *   - 不需要 x-zse-96，所有 voters/thankers/likers/collections 接口实测放行
     * ============================================================================
     */

    const ZHIHU_API_BASE = 'https://www.zhihu.com';

    function getXSRFToken() {
        const match = document.cookie.match(/(?:^|;\s*)_xsrf=([^;]+)/);
        return match ? decodeURIComponent(match[1]) : '';
    }

    function buildZhihuActionUrl(path, query) {
        const url = path.startsWith('http')
            ? new URL(path)
            : new URL(path, ZHIHU_API_BASE);
        if (query && typeof query === 'object') {
            Object.entries(query).forEach(([k, v]) => {
                if (v === undefined || v === null) return;
                url.searchParams.set(k, String(v));
            });
        }
        return url.href;
    }

    async function zhihuFetch(method, path, options = {}) {
        const xsrf = getXSRFToken();
        if (!xsrf) {
            const err = new Error('缺少 _xsrf cookie，请先登录知乎');
            err.code = 'NO_XSRF';
            throw err;
        }

        const headers = {
            'x-xsrftoken': xsrf,
            'x-requested-with': 'fetch',
            'accept': 'application/json, text/plain, */*'
        };
        let body;
        if (options.body !== undefined) {
            headers['content-type'] = 'application/json';
            body = JSON.stringify(options.body);
        }

        const url = buildZhihuActionUrl(path, options.query);

        // zhuanlan.zhihu.com → www.zhihu.com 跨域，需要 GM_xmlhttpRequest
        const isCrossOrigin = !url.startsWith(location.origin);
        const xhr = isCrossOrigin ? getUserscriptXHR() : null;

        if (xhr) {
            return new Promise((resolve, reject) => {
                xhr({
                    method,
                    url,
                    headers,
                    data: body,
                    timeout: 15000,
                    anonymous: false,
                    responseType: 'text',
                    onload: res => {
                        let data = null;
                        if (res.responseText) {
                            try { data = JSON.parse(res.responseText); } catch (e) { data = res.responseText; }
                        }
                        if (res.status >= 200 && res.status < 300) {
                            resolve({ status: res.status, data });
                        } else {
                            const message = (data && typeof data === 'object' && (data.error?.message || data.message))
                                || (typeof data === 'string' && data.slice(0, 200))
                                || `HTTP ${res.status}`;
                            const err = new Error(`知乎接口错误：${message}`);
                            err.status = res.status;
                            err.data = data;
                            reject(err);
                        }
                    },
                    onerror: e => reject(new Error(`知乎接口网络错误：${e?.error || e?.message || '未知错误'}`)),
                    ontimeout: () => reject(new Error('知乎接口请求超时'))
                });
            });
        }

        const res = await fetch(url, {
            method,
            credentials: 'include',
            headers,
            body
        });

        const text = await res.text();
        let data = null;
        if (text) {
            try { data = JSON.parse(text); } catch (err) { data = text; }
        }

        if (!res.ok) {
            const message = (data && typeof data === 'object' && (data.error?.message || data.message))
                || (typeof data === 'string' && data.slice(0, 200))
                || `HTTP ${res.status}`;
            const err = new Error(`知乎接口错误：${message}`);
            err.status = res.status;
            err.data = data;
            throw err;
        }

        return { status: res.status, data };
    }

    function voteAnswer(answerId, dir) {
        if (!answerId) throw new Error('voteAnswer 缺少 answerId');
        if (!['up', 'down', 'neutral'].includes(dir)) throw new Error(`voteAnswer 非法方向：${dir}`);
        return zhihuFetch('POST', `/api/v4/answers/${answerId}/voters`, { body: { type: dir } });
    }

    function voteArticle(articleId, dir) {
        if (!articleId) throw new Error('voteArticle 缺少 articleId');
        if (![1, -1, 0].includes(dir)) throw new Error(`voteArticle 非法方向：${dir}`);
        return zhihuFetch('POST', `/api/v4/articles/${articleId}/voters`, { body: { voting: dir } });
    }

    function thankAnswer(answerId, on) {
        if (!answerId) throw new Error('thankAnswer 缺少 answerId');
        return on
            ? zhihuFetch('POST', `/api/v4/answers/${answerId}/thankers`, { body: {} })
            : zhihuFetch('DELETE', `/api/v4/answers/${answerId}/thankers`);
    }

    async function likeArticle(articleId, on) {
        if (!articleId) throw new Error('likeArticle 缺少 articleId');
        if (on) {
            return zhihuFetch('POST', `/api/v4/articles/${articleId}/likers`, { body: {} });
        }
        try {
            return await zhihuFetch('DELETE', `/api/v4/articles/${articleId}/likers`);
        } catch (err) {
            if (err.status === 404 || err.status === 405) {
                return zhihuFetch('POST', `/api/v4/articles/${articleId}/likers`, { body: { liking: 0 } });
            }
            throw err;
        }
    }

    function normalizeContentType(type) {
        if (type === 'answer' || type === 'article') return type;
        throw new Error(`未支持的收藏类型：${type}`);
    }

    function addCollection(collectionId, contentId, contentType) {
        if (!collectionId) {
            const err = new Error('未配置收藏夹 ID，请到设置面板填入');
            err.code = 'NO_COLLECTION_ID';
            throw err;
        }
        if (!contentId) throw new Error('addCollection 缺少 contentId');
        const t = normalizeContentType(contentType);
        return zhihuFetch('POST', `/api/v4/collections/${collectionId}/contents`, {
            query: { content_id: contentId, content_type: t }
        });
    }

    function removeCollection(collectionId, contentId, contentType) {
        if (!collectionId) {
            const err = new Error('未配置收藏夹 ID，请到设置面板填入');
            err.code = 'NO_COLLECTION_ID';
            throw err;
        }
        if (!contentId) throw new Error('removeCollection 缺少 contentId');
        const t = normalizeContentType(contentType);
        return zhihuFetch('DELETE', `/api/v4/collections/${collectionId}/contents/${contentId}`, {
            query: { content_type: t }
        });
    }

    async function fetchMyCollections(limit = 20) {
        const me = await zhihuFetch('GET', '/api/v4/me');
        const urlToken = me.data?.url_token;
        if (!urlToken) {
            const err = new Error('未获取到当前用户 url_token，请确认已登录');
            err.code = 'NO_URL_TOKEN';
            throw err;
        }
        const include = 'data[*].updated_time,answer_count,follower_count,creator,description,is_following,comment_count,created_time';
        const res = await zhihuFetch('GET', `/api/v4/people/${urlToken}/collections`, {
            query: { include, offset: 0, limit }
        });
        const list = Array.isArray(res.data?.data) ? res.data.data : [];
        return list.map(item => ({
            id: String(item.id),
            title: item.title || '(未命名收藏夹)',
            answerCount: item.answer_count ?? item.item_count ?? 0,
            isDefault: item.is_default === true
        }));
    }

    function getLocalStoredCollectionId() {
        try {
            const raw = localStorage.getItem('zh-immersive-config');
            if (!raw) return '';
            const stored = JSON.parse(raw);
            return String(stored?.defaultCollectionId || '').trim();
        } catch (err) {
            return '';
        }
    }

    async function autoInitializeDefaultCollection() {
        // 仅以当前站点 localStorage 是否已有收藏夹 ID 作为一次性初始化条件。
        if (getLocalStoredCollectionId()) return;

        try {
            const collections = await fetchMyCollections(50);
            const defaultCollection = collections.find(item => item.isDefault);
            if (!defaultCollection?.id) return;
            saveConfig({ defaultCollectionId: defaultCollection.id });
            console.info(`知乎沉浸式阅读：已自动设置默认收藏夹「${defaultCollection.title}」(${defaultCollection.id})`);
        } catch (err) {
            // 启动初始化失败不影响阅读；下次脚本启动且仍未配置时再尝试。
            console.debug('知乎沉浸式阅读：自动获取默认收藏夹失败', err?.message || err);
        }
    }

    // ─── Action Bar 渲染层 ───────────────────────────────────────────────

    const ACTION_ICONS = {
        up: '<svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path fill-rule="evenodd" d="M13.792 3.681c-.781-1.406-2.803-1.406-3.584 0l-7.79 14.023c-.76 1.367.228 3.046 1.791 3.046h15.582c1.563 0 2.55-1.68 1.791-3.046l-7.79-14.023Z" clip-rule="evenodd"></path></svg>',
        down: '<svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path fill-rule="evenodd" d="M13.792 20.319c-.781 1.406-2.803 1.406-3.584 0L2.418 6.296c-.76-1.367.228-3.046 1.791-3.046h15.582c1.563 0 2.55 1.68 1.791 3.046l-7.79 14.023Z" clip-rule="evenodd"></path></svg>',
        comment: '<svg width="1.2em" height="1.2em" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.37c5.67 0 10.266 4.085 10.267 9.125 0 2.08-.786 3.997-2.105 5.532a1.064 1.064 0 0 0-.247.91l.644 3.056c.24 1.157-.66 1.58-1.444 1.157l-2.925-1.584c-.53-.287-1.153-.338-1.743-.21-.784.172-1.604.265-2.447.265-5.67 0-10.268-4.087-10.268-9.126C1.732 6.455 6.33 2.37 12 2.37Z"></path></svg>',
        star: '<svg width="1.2em" height="1.2em" viewBox="0 0 24 24" fill="currentColor"><path d="M10.424 2.828c.7-1.213 2.452-1.213 3.152 0l2.47 4.285c.038.064.1.109.172.124l4.839 1.027c1.37.29 1.912 1.956.974 2.997l-3.312 3.674a.26.26 0 0 0-.065.201l.52 4.92c.146 1.393-1.27 2.422-2.55 1.852l-4.518-2.014a.26.26 0 0 0-.212 0l-4.518 2.014c-1.28.57-2.696-.46-2.55-1.853l.52-4.919a.26.26 0 0 0-.065-.2L1.969 11.26c-.938-1.041-.396-2.707.974-2.997l4.839-1.027a.26.26 0 0 0 .171-.124l2.471-4.285Z"></path></svg>',
        heart: '<svg width="1.2em" height="1.2em" viewBox="0 0 24 24" fill="currentColor"><path fill-rule="evenodd" d="M16.984 3.324c1.73.315 3.125 1.472 4.04 2.978 1.893 3.116.758 6.989-1.384 9.556a23.241 23.241 0 0 1-3.96 3.737c-.66.486-1.308.895-1.902 1.196-.579.294-1.166.517-1.695.57a.845.845 0 0 1-.145.002c-.529-.038-1.127-.267-1.708-.564a14.407 14.407 0 0 1-1.947-1.232 23.512 23.512 0 0 1-4.081-3.88C2.165 13.207 1.139 9.536 2.85 6.514 3.742 4.94 5.14 3.71 6.896 3.348c1.606-.332 3.363.094 5.103 1.394 1.696-1.267 3.409-1.704 4.985-1.418Z" clip-rule="evenodd"></path></svg>'
    };

    const _actionThrottles = new Map();

    function isActionThrottled(key) {
        const now = Date.now();
        if (_actionThrottles.has(key) && now - _actionThrottles.get(key) < 1000) return true;
        _actionThrottles.set(key, now);
        return false;
    }

    function buildActionBar(record) {
        const bar = document.createElement('div');
        bar.className = 'ContentItem-actions zh-api-action-bar';
        bar.dataset.recordKey = record.key || '';

        const isAnswer = record.apiTargetType === 'answer';
        const isArticle = record.apiTargetType === 'article';
        const hasVote = isAnswer || isArticle;
        const hasThank = isAnswer;
        const hasLike = isArticle;

        const voteCount = record.voteup_count ?? 0;
        const isVotedUp = record.voting === 1;
        const isVotedDown = record.voting === -1;

        let html = '';

        if (hasVote) {
            html += `<button class="zh-action-btn zh-action-vote-up${isVotedUp ? ' is-active' : ''}" data-action="vote-up" title="赞同">
                <span style="display:inline-flex;align-items:center">${ACTION_ICONS.up}</span>
                ${isVotedUp ? '已赞同' : '赞同'}${voteCount > 0 ? ' ' + voteCount : ''}
            </button>`;
            html += `<button class="zh-action-btn zh-action-vote-down${isVotedDown ? ' is-active' : ''}" data-action="vote-down" title="反对">
                <span style="display:inline-flex;align-items:center">${ACTION_ICONS.down}</span>
            </button>`;
        }

        // 评论按钮不再跳转原页：原地展开内联评论区（见 toggleInlineComments）。
        // 没有 apiTargetId（拿不到评论 API id）时仍退回新标签页打开原文。
        if (record.comment_count != null || record.apiTargetId) {
            html += `<button class="zh-action-btn zh-action-comment" data-action="comment" title="展开评论">
                <span style="display:inline-flex;align-items:center">${ACTION_ICONS.comment}</span>
                ${record.comment_count > 0 ? record.comment_count + ' 评论' : '评论'}
            </button>`;
        }

        html += `<button class="zh-action-btn zh-action-collect${record.collected ? ' is-active' : ''}" data-action="collect" title="收藏">
            <span style="display:inline-flex;align-items:center">${ACTION_ICONS.star}</span>
            ${record.collected ? '已收藏' : '收藏'}${record.favlists_count > 0 ? ' ' + record.favlists_count : ''}
        </button>`;

        if (hasThank) {
            html += `<button class="zh-action-btn zh-action-thank${record.thanked ? ' is-active' : ''}" data-action="thank" title="感谢">
                <span style="display:inline-flex;align-items:center">${ACTION_ICONS.heart}</span>
                ${record.thanked ? '已感谢' : '感谢'}
            </button>`;
        }
        if (hasLike) {
            html += `<button class="zh-action-btn zh-action-like${record.liked ? ' is-active' : ''}" data-action="like" title="喜欢">
                <span style="display:inline-flex;align-items:center">${ACTION_ICONS.heart}</span>
                ${record.liked ? '已喜欢' : '喜欢'}
            </button>`;
        }

        html += `<a class="zh-action-btn zh-action-open" href="${escapeHTML(record.url || '#')}" target="_blank" rel="noopener noreferrer">打开原文</a>`;

        bar.innerHTML = html;
        bindActionBar(bar, record);
        return bar;
    }

    function bindActionBar(bar, record) {
        // 评论按钮是纯 UI 切换（展开/收起内联评论区），不参与写操作节流与刷新流程。
        const commentBtn = bar.querySelector('[data-action="comment"]');
        if (commentBtn) {
            commentBtn.addEventListener('click', e => {
                e.preventDefault();
                e.stopPropagation();
                toggleInlineComments(bar, record);
            });
        }
        bar.querySelectorAll('[data-action]:not([data-action="comment"])').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.preventDefault();
                e.stopPropagation();
                const action = btn.dataset.action;
                const throttleKey = `${record.key}::${action}`;
                if (isActionThrottled(throttleKey)) return;
                btn.disabled = true;
                btn.style.opacity = '0.5';
                try {
                    await executeAction(record, action);
                    refreshActionBar(bar, record);
                } catch (err) {
                    console.warn('知乎互动失败:', action, err);
                    if (err.code === 'NO_COLLECTION_ID') {
                        showToast('请先到设置面板填入收藏夹 ID');
                    } else if (err.code === 'NO_XSRF' || err.status === 401) {
                        showToast('请先登录知乎');
                    } else {
                        showToast('操作失败：' + (err.message || err).slice(0, 60));
                    }
                } finally {
                    btn.disabled = false;
                    btn.style.opacity = '';
                }
            });
        });
    }

    async function executeAction(record, action) {
        const id = record.apiTargetId;
        const isAnswer = record.apiTargetType === 'answer';
        const isArticle = record.apiTargetType === 'article';

        switch (action) {
            case 'vote-up': {
                const newDir = record.voting === 1 ? 'neutral' : 'up';
                if (isAnswer) {
                    await voteAnswer(id, newDir === 'up' ? 'up' : 'neutral');
                } else {
                    await voteArticle(id, newDir === 'up' ? 1 : 0);
                }
                record.voting = newDir === 'up' ? 1 : 0;
                if (newDir === 'up') record.voteup_count = (record.voteup_count || 0) + 1;
                else record.voteup_count = Math.max(0, (record.voteup_count || 0) - 1);
                break;
            }
            case 'vote-down': {
                const newDir = record.voting === -1 ? 'neutral' : 'down';
                if (record.voting === 1) record.voteup_count = Math.max(0, (record.voteup_count || 0) - 1);
                if (isAnswer) {
                    await voteAnswer(id, newDir === 'down' ? 'down' : 'neutral');
                } else {
                    await voteArticle(id, newDir === 'down' ? -1 : 0);
                }
                record.voting = newDir === 'down' ? -1 : 0;
                break;
            }
            case 'thank': {
                const on = !record.thanked;
                await thankAnswer(id, on);
                record.thanked = on;
                break;
            }
            case 'like': {
                const on = !record.liked;
                await likeArticle(id, on);
                record.liked = on;
                break;
            }
            case 'collect': {
                const cid = config.defaultCollectionId;
                const contentType = isAnswer ? 'answer' : 'article';
                if (record.collected) {
                    await removeCollection(cid, id, contentType);
                    record.collected = false;
                } else {
                    await addCollection(cid, id, contentType);
                    record.collected = true;
                }
                break;
            }
        }
        persistActiveFeedCacheAfterAction();
    }

    // 互动状态必须写回「当前上下文」对应的缓存。
    // 原实现无条件调用 persistHomeFeedCache()：在关注页会把 _homeState 写进
    // `${pathname}::topstory` 这个错 key。
    // 问题页已改为每次重新采集、不落盘，互动状态只存活在当前会话的 _questionState 里，
    // 因此这里直接跳过，不需要持久化。
    function persistActiveFeedCacheAfterAction() {
        try {
            if (typeof isQuestionPage === 'function' && isQuestionPage()) return;
            if (typeof isFollowPage === 'function' && isFollowPage()) {
                persistFollowFeedCache();
                return;
            }
            persistHomeFeedCache();
        } catch (err) {
            console.warn('知乎沉浸式阅读：互动状态持久化失败', err);
        }
    }

    function refreshActionBar(bar, record) {
        const newBar = buildActionBar(record);
        bar.innerHTML = newBar.innerHTML;
        bindActionBar(bar, record);
    }

    // ─── 内联评论区 ─────────────────────────────────────────────────────
    // 评论按钮原来是个 <a target="_blank">，点击会跳转/新开原页，原生页的评论区
    // 在沉浸视图里又不可见。这里改为点击后原地展开评论区：
    //   GET /api/v4/answers/{id}/root_comments（回答）/ articles/{id}/root_comments（文章）
    //   与 feeds API 同一权限模型：登录 cookie 即可，无需 x-zse-96 签名。
    // 只读展示（正文、作者、时间、点赞数、楼中楼回复），不发评论写接口。

    function buildZhihuCommentsUrl(targetType, targetId, nextUrl) {
        if (nextUrl) {
            try { return new URL(nextUrl, location.origin).href; } catch (err) { return nextUrl; }
        }
        const path = targetType === 'article'
            ? `/api/v4/articles/${targetId}/root_comments`
            : `/api/v4/answers/${targetId}/root_comments`;
        return buildZhihuActionUrl(path, { limit: 20, offset: 0, order: 'normal', status: 'open' });
    }

    function formatCommentTime(ts) {
        const time = Number(ts) * 1000;
        if (!Number.isFinite(time) || time <= 0) return '';
        const diff = Date.now() - time;
        if (diff < 60 * 1000) return '刚刚';
        if (diff < 60 * 60 * 1000) return `${Math.floor(diff / 60000)} 分钟前`;
        if (diff < 24 * 60 * 60 * 1000) return `${Math.floor(diff / 3600000)} 小时前`;
        if (diff < 7 * 24 * 60 * 60 * 1000) return `${Math.floor(diff / 86400000)} 天前`;
        const d = new Date(time);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }

    // 评论 content 是知乎返回的 HTML 片段：去脚本类节点、on* 属性与 javascript: 链接，
    // 外链统一新标签页打开。
    function sanitizeCommentHTML(html) {
        const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
        doc.querySelectorAll('script, style, iframe, object, embed, form, link').forEach(el => el.remove());
        doc.querySelectorAll('*').forEach(el => {
            Array.from(el.attributes).forEach(attr => {
                const name = attr.name.toLowerCase();
                if (name.startsWith('on')) el.removeAttribute(attr.name);
                else if ((name === 'href' || name === 'src') && /^\s*javascript:/i.test(attr.value)) el.removeAttribute(attr.name);
            });
        });
        doc.querySelectorAll('a').forEach(a => {
            a.setAttribute('target', '_blank');
            a.setAttribute('rel', 'noopener noreferrer nofollow');
        });
        return doc.body.innerHTML;
    }

    // 拉取楼中楼回复（分页）。
    // 知乎 web「查看全部回复」实际走 comment_v5（注意单数 child_comment），order_by=ts 按时间排序；
    // 旧的 /api/v4/comments/{id}/child_comments 已失效（返回空数据），仅作兜底。
    // 返回 { items, next }，next 为 paging.next 下一页地址。
    async function fetchZhihuChildCommentsPage(commentId, nextUrl) {
        if (nextUrl) {
            const url = new URL(nextUrl, location.origin).href;
            const data = await gmFetchJSON(url);
            return {
                items: Array.isArray(data?.data) ? data.data : [],
                next: (data?.paging && !data.paging.is_end && data.paging.next) || ''
            };
        }
        try {
            const url = buildZhihuActionUrl(`/api/v4/comment_v5/comment/${commentId}/child_comment`, { order_by: 'ts', limit: 20, offset: 0 });
            const data = await gmFetchJSON(url);
            const items = Array.isArray(data?.data) ? data.data : [];
            if (items.length || data?.paging) {
                return {
                    items,
                    next: (data?.paging && !data.paging.is_end && data.paging.next) || ''
                };
            }
            throw new Error('V5_EMPTY');
        } catch (err) {
            const url = buildZhihuActionUrl(`/api/v4/comments/${commentId}/child_comments`, { limit: 20, offset: 0, order: 'asc', status: 'open' });
            const data = await gmFetchJSON(url);
            return {
                items: Array.isArray(data?.data) ? data.data : [],
                next: (data?.paging && !data.paging.is_end && data.paging.next) || ''
            };
        }
    }

    function renderZhihuCommentItem(comment) {
        const member = comment?.author?.member || comment?.author || {};
        const item = document.createElement('div');
        item.className = 'zh-comment-item';
        const avatarHTML = member.avatar_url
            ? `<img class="zh-comment-avatar" src="${escapeHTML(member.avatar_url)}" alt="">`
            : '';
        const likeCount = Number(comment.like_count ?? comment.vote_count) || 0;
        const likeHTML = likeCount > 0 ? `<span class="zh-comment-likes">♥ ${likeCount}</span>` : '';
        item.innerHTML = `
            <div class="zh-comment-main">
                ${avatarHTML}
                <div class="zh-comment-body">
                    <div class="zh-comment-head">
                        <span class="zh-comment-author">${escapeHTML(member.name || '匿名用户')}</span>
                        <span class="zh-comment-time">${escapeHTML(formatCommentTime(comment.created_time))}</span>
                    </div>
                    <div class="zh-comment-content">${sanitizeCommentHTML(comment.content)}</div>
                    ${likeHTML}
                </div>
            </div>`;

        // 楼中楼：root_comments 内嵌 child_comments；超出内嵌数量时按需拉全量回复。
        const childCount = Number(comment.child_comment_count) || 0;
        const embedded = Array.isArray(comment.child_comments) ? comment.child_comments : [];
        if (childCount > 0 || embedded.length) {
            const replies = document.createElement('div');
            replies.className = 'zh-comment-replies';
            embedded.forEach(child => replies.appendChild(renderZhihuCommentItem(child)));
            if (embedded.length < childCount && comment.id) {
                const more = document.createElement('button');
                more.className = 'zh-comment-more-btn';
                more.textContent = `查看全部 ${childCount} 条回复`;
                let nextUrl = '';
                more.addEventListener('click', async () => {
                    more.disabled = true;
                    more.textContent = '正在加载回复...';
                    try {
                        const page = await fetchZhihuChildCommentsPage(comment.id, nextUrl);
                        if (!page.items.length && !nextUrl) {
                            more.textContent = '没有更多回复了';
                            return;
                        }
                        // 首次加载替换内嵌的前几条，避免重复；后续分页直接追加。
                        if (!nextUrl) replies.querySelectorAll('.zh-comment-item').forEach(el => el.remove());
                        page.items.forEach(child => replies.appendChild(renderZhihuCommentItem(child)));
                        if (page.next) {
                            nextUrl = page.next;
                            more.disabled = false;
                            more.textContent = '查看更多回复';
                        } else {
                            more.remove();
                        }
                    } catch (err) {
                        more.disabled = false;
                        more.textContent = '回复加载失败，点击重试';
                    }
                });
                replies.appendChild(more);
            }
            item.appendChild(replies);
        }
        return item;
    }

    async function loadInlineComments(panel, record, nextUrl = '') {
        const body = panel.querySelector('.zh-inline-comments-body');
        const targetType = record.apiTargetType === 'article' ? 'article' : 'answer';
        try {
            const url = buildZhihuCommentsUrl(targetType, record.apiTargetId, nextUrl);
            const data = await gmFetchJSON(url);
            panel.querySelector('.zh-comments-loading')?.remove();
            panel.querySelector('.zh-comments-error')?.remove();
            if (nextUrl) panel.querySelector('.zh-comments-more-btn')?.remove();

            let list = panel.querySelector('.zh-comments-list');
            if (!list) {
                list = document.createElement('div');
                list.className = 'zh-comments-list';
                body.appendChild(list);
            }

            const items = Array.isArray(data?.data) ? data.data : [];
            if (!items.length && !list.childElementCount) {
                body.innerHTML = '<div class="zh-comments-empty">暂无评论</div>';
                return;
            }
            items.forEach(comment => list.appendChild(renderZhihuCommentItem(comment)));

            const paging = data?.paging || {};
            if (paging.next && !paging.is_end) {
                const moreBtn = document.createElement('button');
                moreBtn.className = 'zh-comments-more-btn';
                moreBtn.textContent = '加载更多评论';
                moreBtn.addEventListener('click', async () => {
                    moreBtn.disabled = true;
                    moreBtn.textContent = '正在加载...';
                    await loadInlineComments(panel, record, paging.next);
                });
                body.appendChild(moreBtn);
            }
        } catch (err) {
            panel.querySelector('.zh-comments-loading')?.remove();
            panel.querySelector('.zh-comments-more-btn')?.remove();
            let errEl = panel.querySelector('.zh-comments-error');
            if (!errEl) {
                errEl = document.createElement('div');
                errEl.className = 'zh-comments-error';
                body.appendChild(errEl);
            }
            errEl.textContent = `评论加载失败：${(err.message || err).slice(0, 60)}`;
        }
    }

    function toggleInlineComments(bar, record) {
        const existing = bar.nextElementSibling;
        if (existing?.classList?.contains('zh-inline-comments')) {
            existing.remove();
            bar.querySelector('[data-action="comment"]')?.classList.remove('is-active');
            return;
        }
        // 没有 API id 的记录退回原行为：新标签页打开原文。
        if (!record.apiTargetId) {
            if (record.url) window.open(record.url, '_blank', 'noopener');
            return;
        }

        const commentCount = Number(record.comment_count) || 0;
        const panel = document.createElement('div');
        panel.className = 'zh-inline-comments';
        panel.innerHTML = `
            <div class="zh-inline-comments-head">评论${commentCount > 0 ? ` ${commentCount} 条` : ''}</div>
            <div class="zh-inline-comments-body">
                <div class="zh-comments-loading"><span class="zh-spinner"></span>正在加载评论...</div>
            </div>
        `;
        bar.insertAdjacentElement('afterend', panel);
        bar.querySelector('[data-action="comment"]')?.classList.add('is-active');
        loadInlineComments(panel, record);
        panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
