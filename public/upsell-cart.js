(function () {
  var FALLBACK_IMAGE =
    "https://cdn.shopify.com/static/images/examples/img-placeholder-1120x1120.png";
  var POPUP_ACTIVE_KEY = "upsell_cart_popup_active";
  var LAST_ADDED_TS_KEY = "upsell_last_add_ts";
  var LAST_CART_COUNT_KEY = "upsell_last_cart_count";
  var scriptEl = document.currentScript;
  if (!scriptEl) return;

  var appOrigin = "";
  try {
    appOrigin = new URL(scriptEl.src).origin;
  } catch (_err) {
    return;
  }

  var shop = window.location.hostname;
  if (!shop || !shop.endsWith(".myshopify.com")) return;

  var translations = {
    en: {
      heading: "Complete your order with this offer",
      add: "Add to cart",
      decline: "No, thanks",
      adding: "Adding...",
      saved: "Discount will be applied at checkout.",
      discountLabel: "discount",
    },
    tr: {
      heading: "Siparisini bu teklifle tamamla",
      add: "Sepete ekle",
      decline: "Hayir, tesekkurler",
      adding: "Ekleniyor...",
      saved: "Indirim checkout adiminda uygulanir.",
      discountLabel: "indirim",
    },
    de: {
      heading: "Vervollstandige deine Bestellung mit diesem Angebot",
      add: "In den Warenkorb",
      decline: "Nein, danke",
      adding: "Wird hinzugefugt...",
      saved: "Der Rabatt wird im Checkout angewendet.",
      discountLabel: "Rabatt",
    },
    fr: {
      heading: "Completez votre commande avec cette offre",
      add: "Ajouter au panier",
      decline: "Non merci",
      adding: "Ajout en cours...",
      saved: "La remise sera appliquee au paiement.",
      discountLabel: "remise",
    },
    es: {
      heading: "Completa tu pedido con esta oferta",
      add: "Agregar al carrito",
      decline: "No, gracias",
      adding: "Agregando...",
      saved: "El descuento se aplicara en el checkout.",
      discountLabel: "descuento",
    },
    it: {
      heading: "Completa il tuo ordine con questa offerta",
      add: "Aggiungi al carrello",
      decline: "No, grazie",
      adding: "Aggiunta...",
      saved: "Lo sconto verra applicato al checkout.",
      discountLabel: "sconto",
    },
    pt: {
      heading: "Conclua seu pedido com esta oferta",
      add: "Adicionar ao carrinho",
      decline: "Nao, obrigado",
      adding: "Adicionando...",
      saved: "O desconto sera aplicado no checkout.",
      discountLabel: "desconto",
    },
    nl: {
      heading: "Rond je bestelling af met deze aanbieding",
      add: "Toevoegen aan winkelwagen",
      decline: "Nee, bedankt",
      adding: "Toevoegen...",
      saved: "Korting wordt toegepast bij checkout.",
      discountLabel: "korting",
    },
    ru: {
      heading: "Zavershite zakaz s etim predlozheniem",
      add: "Dobavit v korzinu",
      decline: "Net, spasibo",
      adding: "Dobavlyaetsya...",
      saved: "Skidka budet primenena na checkout.",
      discountLabel: "skidka",
    },
    ar: {
      heading: "Akmel talabak bihatha al-ard",
      add: "Add ila alsalla",
      decline: "La shukran",
      adding: "Jari al-idafa...",
      saved: "Sayatimu tatbiq al-khasm fi checkout.",
      discountLabel: "khasm",
    },
  };

  var configState = null;
  loadConfig()
    .then(function (config) {
      configState = config;
      attachCartAddListeners();
      startCartCountWatcher();
    })
    .catch(function () {
      // noop
    });

  function loadConfig() {
    return fetch(appOrigin + "/upsell-config?shop=" + encodeURIComponent(shop))
      .then(function (res) {
        return res.ok ? res.json() : null;
      })
      .then(function (config) {
        if (!config || !config.ok) return null;
        var offers = Array.isArray(config.offers) ? config.offers : config.offer ? [config.offer] : [];
        if (!offers.length) return null;
        return { offers: offers };
      });
  }

  function getLocaleCode() {
    var current = configState && configState.offers && configState.offers[0];
    if (current && current.localePreference && current.localePreference !== "auto") {
      return String(current.localePreference).slice(0, 2).toLowerCase();
    }
    var htmlLang = (document.documentElement.lang || navigator.language || "en")
      .slice(0, 2)
      .toLowerCase();
    return htmlLang;
  }

  function t() {
    var locale = getLocaleCode();
    return translations[locale] || translations.en;
  }

  function maybeShowOffer() {
    if (!configState || !Array.isArray(configState.offers) || !configState.offers.length) return;
    if (sessionStorage.getItem(POPUP_ACTIVE_KEY) === "1") return;

    var lastAddTs = Number(sessionStorage.getItem(LAST_ADDED_TS_KEY) || "0");
    if (!lastAddTs || Date.now() - lastAddTs > 10000) return;

    fetch("/cart.js")
      .then(function (res) {
        return res.ok ? res.json() : null;
      })
      .then(function (cart) {
        if (!cart || !Array.isArray(cart.items)) return;
        if (cart.items.length < 1) return;

        var eligibleOffers = getEligibleOffers(configState.offers, cart.items);
        if (!eligibleOffers.length) return;

        showPopup(eligibleOffers.slice(0, 3));
      })
      .catch(function () {
        // noop
      });
  }

  function getEligibleOffers(offers, cartItems) {
    return offers.filter(function (offer) {
      var variantId = String(offer.variantId || "");
      if (!variantId) return false;
      return !cartItems.some(function (item) {
        return String(item.variant_id) === variantId;
      });
    });
  }

  function attachCartAddListeners() {
    var originalFetch = window.fetch;
    window.fetch = function (input, init) {
      return originalFetch(input, init).then(function (res) {
        var url = "";
        try {
          url = typeof input === "string" ? input : input.url || "";
        } catch (_err) {
          // noop
        }
        if (res && res.ok && url.indexOf("/cart/add") !== -1) {
          sessionStorage.setItem(LAST_ADDED_TS_KEY, String(Date.now()));
          setTimeout(maybeShowOffer, 220);
        }
        return res;
      });
    };

    var originalOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method, url) {
      this.__upsellUrl = url;
      return originalOpen.apply(this, arguments);
    };
    var originalSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function () {
      this.addEventListener("load", function () {
        if (this.status >= 200 && this.status < 300) {
          var url = this.__upsellUrl || "";
          if (String(url).indexOf("/cart/add") !== -1) {
            sessionStorage.setItem(LAST_ADDED_TS_KEY, String(Date.now()));
            setTimeout(maybeShowOffer, 220);
          }
        }
      });
      return originalSend.apply(this, arguments);
    };

    document.addEventListener(
      "submit",
      function (event) {
        var form = event.target;
        if (!form || typeof form.getAttribute !== "function") return;
        var action = form.getAttribute("action") || "";
        if (action.indexOf("/cart/add") !== -1) {
          sessionStorage.setItem(LAST_ADDED_TS_KEY, String(Date.now()));
          setTimeout(maybeShowOffer, 250);
        }
      },
      true,
    );
  }

  function showPopup(offers) {
    if (!Array.isArray(offers) || !offers.length) return;
    var mainOffer = offers[0];
    var i18n = t();
    var headingText = mainOffer.headingText || i18n.heading;
    var addButtonText = mainOffer.addButtonText || i18n.add;
    var declineButtonText = mainOffer.declineButtonText || i18n.decline;
    var noteText = mainOffer.noteText || i18n.saved;
    var cardBackgroundColor = mainOffer.cardBackgroundColor || "#ffffff";
    var primaryButtonColor = mainOffer.primaryButtonColor || "#111827";

    sessionStorage.setItem(POPUP_ACTIVE_KEY, "1");
    var overlay = document.createElement("div");
    overlay.style.position = "fixed";
    overlay.style.inset = "0";
    overlay.style.background = "rgba(0,0,0,0.35)";
    overlay.style.zIndex = "99999";
    overlay.style.display = "flex";
    overlay.style.alignItems = "center";
    overlay.style.justifyContent = "center";
    overlay.onclick = function (event) {
      if (event.target === overlay) {
        sessionStorage.removeItem(POPUP_ACTIVE_KEY);
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      }
    };

    var card = document.createElement("div");
    card.style.width = "min(450px, 92vw)";
    card.style.background = cardBackgroundColor;
    card.style.borderRadius = "14px";
    card.style.boxShadow = "0 14px 28px rgba(0,0,0,0.22)";
    card.style.padding = "18px";
    card.style.fontFamily = "inherit";

    var heading = document.createElement("div");
    heading.textContent = headingText;
    heading.style.fontSize = "19px";
    heading.style.fontWeight = "700";
    heading.style.marginBottom = "12px";

    var offersWrap = document.createElement("div");
    offersWrap.style.display = "grid";
    offersWrap.style.gap = "8px";

    offers.forEach(function (offer) {
      var row = document.createElement("div");
      row.style.display = "grid";
      row.style.gridTemplateColumns = "56px 1fr auto";
      row.style.gap = "10px";
      row.style.alignItems = "center";
      row.style.padding = "8px";
      row.style.border = "1px solid #e5e7eb";
      row.style.borderRadius = "10px";
      row.style.background = "#fff";

      var image = document.createElement("img");
      image.src = offer.imageUrl || FALLBACK_IMAGE;
      image.alt = offer.title || "Upsell";
      image.width = 56;
      image.height = 56;
      image.style.objectFit = "cover";
      image.style.borderRadius = "8px";

      var textWrap = document.createElement("div");
      var title = document.createElement("div");
      title.textContent = offer.title || "Special offer";
      title.style.fontWeight = "700";
      title.style.fontSize = "14px";

      var originalPrice = document.createElement("div");
      originalPrice.textContent = offer.price || "";
      originalPrice.style.textDecoration = "line-through";
      originalPrice.style.color = "#6b7280";
      originalPrice.style.fontSize = "12px";

      var discountedPriceText = getDiscountedPriceText(offer.price, offer.discountPercent);
      var discountedPrice = document.createElement("div");
      discountedPrice.textContent = discountedPriceText;
      discountedPrice.style.color = "#111827";
      discountedPrice.style.fontWeight = "700";
      discountedPrice.style.fontSize = "13px";

      var discountBadge = document.createElement("div");
      discountBadge.textContent = Number(offer.discountPercent || 30) + "% " + i18n.discountLabel;
      discountBadge.style.color = "#047857";
      discountBadge.style.fontWeight = "700";
      discountBadge.style.fontSize = "12px";

      textWrap.appendChild(title);
      if (offer.price) textWrap.appendChild(originalPrice);
      if (discountedPriceText) textWrap.appendChild(discountedPrice);
      textWrap.appendChild(discountBadge);

      var addBtn = document.createElement("button");
      addBtn.textContent = addButtonText;
      addBtn.style.padding = "8px 10px";
      addBtn.style.border = "none";
      addBtn.style.background = primaryButtonColor;
      addBtn.style.color = "#fff";
      addBtn.style.borderRadius = "8px";
      addBtn.style.cursor = "pointer";
      addBtn.style.whiteSpace = "nowrap";
      addBtn.onclick = function () {
        addBtn.disabled = true;
        addBtn.textContent = i18n.adding;
        fetch("/cart/add.js", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            items: [{ id: Number(String(offer.variantId || "0")), quantity: 1 }],
          }),
        })
          .then(function (res) {
            if (!res.ok) throw new Error("Failed");
            return res.json();
          })
          .then(function () {
            sessionStorage.removeItem(POPUP_ACTIVE_KEY);
            if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
            if (offer.discountCode) {
              window.location.href =
                "/discount/" + encodeURIComponent(offer.discountCode) + "?redirect=/cart";
              return;
            }
            window.location.reload();
          })
          .catch(function () {
            addBtn.disabled = false;
            addBtn.textContent = addButtonText;
          });
      };

      row.appendChild(image);
      row.appendChild(textWrap);
      row.appendChild(addBtn);
      offersWrap.appendChild(row);
    });

    var note = document.createElement("div");
    note.textContent = noteText;
    note.style.fontSize = "12px";
    note.style.color = "#6b7280";
    note.style.marginTop = "10px";

    var actions = document.createElement("div");
    actions.style.display = "flex";
    actions.style.gap = "8px";
    actions.style.justifyContent = "center";
    actions.style.marginTop = "14px";

    var closeBtn = document.createElement("button");
    closeBtn.textContent = declineButtonText;
    closeBtn.style.padding = "10px 12px";
    closeBtn.style.border = "1px solid #d1d5db";
    closeBtn.style.background = "#fff";
    closeBtn.style.borderRadius = "8px";
    closeBtn.style.cursor = "pointer";
    closeBtn.onclick = function () {
      sessionStorage.removeItem(POPUP_ACTIVE_KEY);
      document.body.removeChild(overlay);
    };

    actions.appendChild(closeBtn);
    card.appendChild(heading);
    card.appendChild(offersWrap);
    card.appendChild(note);
    card.appendChild(actions);
    overlay.appendChild(card);
    document.body.appendChild(overlay);
  }

  function getDiscountedPriceText(priceText, discountPercent) {
    if (!priceText) return "";
    var numeric = parseFloat(String(priceText).replace(",", ".").replace(/[^0-9.]/g, ""));
    if (!isFinite(numeric) || numeric <= 0) return "";
    var discounted = numeric * (1 - Number(discountPercent || 0) / 100);
    var prefixMatch = String(priceText).match(/^[^0-9]*/);
    var suffixMatch = String(priceText).match(/[^0-9.,]*$/);
    var prefix = prefixMatch ? prefixMatch[0] : "";
    var suffix = suffixMatch ? suffixMatch[0] : "";
    return prefix + discounted.toFixed(2) + suffix;
  }

  function startCartCountWatcher() {
    refreshCartCount();
    setInterval(function () {
      refreshCartCount();
    }, 2000);
  }

  function refreshCartCount() {
    fetch("/cart.js")
      .then(function (res) {
        return res.ok ? res.json() : null;
      })
      .then(function (cart) {
        if (!cart || typeof cart.item_count !== "number") return;
        var previous = Number(sessionStorage.getItem(LAST_CART_COUNT_KEY) || "0");
        if (isFinite(previous) && cart.item_count > previous) {
          sessionStorage.setItem(LAST_ADDED_TS_KEY, String(Date.now()));
          setTimeout(maybeShowOffer, 200);
        }
        sessionStorage.setItem(LAST_CART_COUNT_KEY, String(cart.item_count));
      })
      .catch(function () {
        // noop
      });
  }
})();
