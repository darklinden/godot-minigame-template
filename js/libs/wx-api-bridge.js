/**
 * WeChat Mini Game API wrappers for Godot JavaScriptBridge integration.
 *
 * Each wrapper stores its Godot callback on `window._wx*Cb`, calls the
 * WeChat API, and invokes the stored callback with the result.
 *
 * Usage from GDScript:
 *
 *   # Login
 *   var cb = JavaScriptBridge.create_callback(func(result))
 *   JavaScriptBridge.get_interface("window")._wxLoginCb = cb
 *   JavaScriptBridge.eval("GameGlobal.__wxLogin()")
 *   var code = await awaiter.wait()
 *
 *   # GetUserInfo
 *   JavaScriptBridge.get_interface("window")._wxUserInfoCb = cb2
 *   JavaScriptBridge.eval("GameGlobal.__wxGetUserInfo()")
 *   var info = await awaiter.wait()
 *
 *   # Show ad (interstitial = false for rewarded, true for interstitial)
 *   JavaScriptBridge.get_interface("window")._wxAdCb = cb3
 *   JavaScriptBridge.eval("GameGlobal.__wxShowAd(false)")
 */

/**
 * wx.login() — returns {code} on success, "" on failure.
 * Callback stored at: window._wxLoginCb
 */
GameGlobal.__wxLogin = function () {
    var cb = window._wxLoginCb;
    wx.login({
        success: function (res) {
            if (cb) cb(typeof res.code === "string" ? res.code : "");
        },
        fail: function () {
            if (cb) cb("");
        },
    });
};

/**
 * wx.getUserInfo() — returns JSON string of user info on success, "" on failure.
 * Callback stored at: window._wxUserInfoCb
 */
GameGlobal.__wxGetUserInfo = function () {
    var cb = window._wxUserInfoCb;
    wx.getUserInfo({
        success: function (res) {
            if (cb) {
                var info = {
                    nickName: res.userInfo.nickName || "",
                    avatarUrl: res.userInfo.avatarUrl || "",
                    gender: res.userInfo.gender || 0,
                    country: res.userInfo.country || "",
                    province: res.userInfo.province || "",
                    city: res.userInfo.city || "",
                    language: res.userInfo.language || "",
                };
                cb(JSON.stringify(info));
            }
        },
        fail: function () {
            if (cb) cb("");
        },
    });
};

/**
 * wx.createInterstitialAd() / wx.createRewardedVideoAd()
 *
 * Parameters:
 *   @param {boolean} interstitial - true = interstitial, false = rewarded video
 *   @param {string}  adUnitId     - WeChat ad unit ID (optional, falls back to window.__wxAdUnitId)
 *
 * Callbacks stored at:
 *   window._wxAdCb          — called with "ok" (watched), "cancel" (skipped), "fail" (error)
 *   window._wxAdUnitId      — set this before calling to configure the ad unit ID
 */
GameGlobal.__wxShowAd = function (interstitial, adUnitId) {
    var cb = window._wxAdCb;
    var unitId = adUnitId || window.__wxAdUnitId || "";

    if (!unitId) {
        if (cb) cb("fail");
        return;
    }

    var ad;
    if (interstitial) {
        ad = wx.createInterstitialAd({ adUnitId: unitId });
    } else {
        ad = wx.createRewardedVideoAd({ adUnitId: unitId });
    }

    ad.onError(function () {
        if (cb) cb("fail");
    });

    ad.onClose(function (res) {
        if (res && res.isEnded) {
            if (cb) cb("ok");
        } else {
            if (cb) cb("cancel");
        }
    });

    ad.show().catch(function () {
        // show() rejects when the ad is not ready; try load then show
        ad.load().then(function () {
            return ad.show();
        }).catch(function () {
            if (cb) cb("fail");
        });
    });
};

/**
 * wx.onShow() — registers a persistent listener for show events.
 * Called once during init. The callback is stored at window._wxOnShowCb.
 *
 * Callback receives: JSON string {shareTicket: string, query: object}
 */
GameGlobal.__wxOnShow = function () {
    var cb = window._wxOnShowCb;
    wx.onShow(function (res) {
        if (cb) {
            var payload = JSON.stringify({
                shareTicket: res.shareTicket || "",
                query: res.query || {},
            });
            cb(payload);
        }
    });
};
