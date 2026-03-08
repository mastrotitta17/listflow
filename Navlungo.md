# Navlungo Entegrasyonu

## 1. Amaç
Listflow içindeki sipariş sevkiyat akışı artık tekrar Navlungo üzerinden çalışır.
Kullanıcı akışı değişmez:
1. Kullanıcı sipariş oluşturur.
2. Stripe ile ödeme alınır.
3. Ödeme başarılı olunca backend Navlungo sevkiyat akışını başlatır.
4. Etiket, takip ve sevkiyat referansları `orders` tablosuna yazılır.

## 2. Yetkilendirme Modeli
Bu projede `tek ortak Navlungo hesabı` kullanılır.

Bu şu anlama gelir:
- Her Listflow kullanıcısı kendi Navlungo hesabını bağlamaz.
- Admin, bir kez ortak Navlungo hesabıyla authorize olur.
- Navlungo bu authorize işlemi sonucunda `authorization_code` döndürür.
- Backend bu kod ile `access_token + refresh_token` alır.
- `refresh_token` veritabanında saklanır.
- Sonraki tüm shipment/store/quote istekleri bu ortak bağlantı üzerinden yapılır.

## 3. `client_id` ve `client_secret` Ne?
Bunlar Navlungo tarafından uygulamaya verilir.
Kullanıcı hesabı değildir.

Akış şöyledir:
1. Callback URL Navlungo’ya iletilir.
2. Navlungo sana `client_id` ve `client_secret` verir.
3. Admin panelden `Navlungo'yu Bağla` aksiyonu çalıştırılır.
4. Admin ortak Navlungo hesabıyla giriş yapar.
5. Callback endpointine `code` ile dönülür.
6. Backend token alır ve bağlantıyı kaydeder.

## 4. QA / Prod Ortamları
### QA
- Website authorize URL: `https://qa.navlungo.com/authorize`
- API base URL: `https://api-qa.navlungo.com`

### Prod
- Website authorize URL: `https://navlungo.com/authorize`
- API base URL: `https://api.navlungo.com`

Aktif ortam `NAVLUNGO_ENV` ile seçilir.

## 5. Callback URL Standardı
Bu projede kullanılan callback endpoint:
- Local: `http://localhost:3000/api/admin/navlungo/connect/callback`
- Prod: `https://listflow.pro/api/admin/navlungo/connect/callback`

Not:
- Navlungo authorize isteğinde callback URL querystring ile taşınmıyor.
- Callback URL Navlungo tarafında uygulama tanımına bağlı.
- Start route yalnızca `client_id`, `code_challenge` ve `state` gönderir.

## 6. Kullanılan Route'lar
### Admin OAuth Route'ları
- `GET /api/admin/navlungo/connect/start`
  - Admin için authorize akışını başlatır.
  - PKCE `code_verifier` ve `state` cookie’ye yazılır.
- `GET /api/admin/navlungo/connect/callback`
  - Navlungo’dan dönen `code` değerini alır.
  - Token exchange yapar.
  - `navlungo_connections` tablosunu günceller.
- `GET /api/admin/navlungo/status`
  - Aktif ortamda bağlantı durumu döndürür.
- `POST /api/admin/navlungo/disconnect`
  - Aktif ortamın Navlungo bağlantısını kaldırır.

### Sipariş / Shipment Akışı
- `POST /api/orders`
  - Siparişi oluşturur.
  - Shipment başlatmaz.
  - Ödeme sonrası shipment başlayacağını döner.
- `lib/stripe/checkout-payment-sync.ts`
  - Stripe ödeme tamamlanınca Navlungo shipment akışını tetikler.

## 7. Veritabanı Yapısı
### Yeni Tablo
`public.navlungo_connections`

Amaç:
- Ortak Navlungo bağlantısının refresh token bilgisini saklamak.

Alanlar:
- `environment`
- `client_id`
- `refresh_token`
- `access_token`
- `access_token_expires_at`
- `connected_email`
- `connected_at`
- `created_by`
- `updated_by`
- `created_at`
- `updated_at`

### Var Olan Alanlar
`public.orders`
- `navlungo_status`
- `navlungo_error`
- `navlungo_store_id`
- `navlungo_search_id`
- `navlungo_quote_reference`
- `navlungo_shipment_id`
- `navlungo_shipment_reference`
- `navlungo_tracking_url`
- `navlungo_response`
- `navlungo_last_synced_at`
- generic shipment alanları (`shipment_status`, `shipment_provider`, vb.)

`public.stores`
- `navlungo_store_id`

## 8. Siparişten Sevkiyata Akış
Aktif zincir:
1. Sipariş oluşturulur.
2. Stripe checkout tamamlanır.
3. `syncOneTimeCheckoutPayment(...)` çalışır.
4. Order `paid` yapılır.
5. Store için `navlungo_store_id` varsa reuse edilir.
6. Yoksa Navlungo `createStore` çağrılır.
7. Quote oluşturulur.
8. İlk quote seçilir.
9. `shipStoreOrder` çağrılır.
10. Label çözümü yapılır:
   - önce `GET label`
   - yoksa `POST create label`
   - sonra tekrar `GET label`
11. Takip / label / response bilgileri order satırına yazılır.

## 9. Gönderici Profili
Gönderici bilgileri her zaman sabittir.
Kullanıcıya veya mağazaya göre değişmez.

Kullanılan env alanları:
- `NAVLUNGO_SENDER_ADDRESS_TYPE`
- `NAVLUNGO_SENDER_IDENTIFICATION_NUMBER`
- `NAVLUNGO_SENDER_COMPANY_NAME`
- `NAVLUNGO_SENDER_TAX_OFFICE`
- `NAVLUNGO_SENDER_NAME`
- `NAVLUNGO_SENDER_PHONE`
- `NAVLUNGO_SENDER_EMAIL`
- `NAVLUNGO_SENDER_ADDRESS1`
- `NAVLUNGO_SENDER_ADDRESS2`
- `NAVLUNGO_SENDER_ADDRESS3`
- `NAVLUNGO_SENDER_COUNTRY`
- `NAVLUNGO_SENDER_CITY`
- `NAVLUNGO_SENDER_TOWN`
- `NAVLUNGO_SENDER_STATE`
- `NAVLUNGO_SENDER_ZIP`

Bu projede aktif sabit gönderici profili:
- Ad Soyad: Teoman Demirbaş
- Telefon: +905449420223
- E-posta: demirteo2@gmail.com
- Adres: Fulya Mah. Özlüce Sok. No 20 / D13 Şişli
- Şehir: İstanbul
- İlçe: Şişli
- Posta Kodu: 34394
- Ülke: TR

## 10. Navlungo Env Alanları
Zorunlu:
- `NAVLUNGO_ENV`
- `NAVLUNGO_CLIENT_ID`
- `NAVLUNGO_CLIENT_SECRET`
- `NAVLUNGO_OAUTH_STATE_SECRET`

Önerilen:
- `NAVLUNGO_TIMEOUT_MS`
- `NAVLUNGO_SCOPE`
- `NAVLUNGO_SHIPMENT_TYPE`
- `NAVLUNGO_DEFAULT_HS_CODE`
- `NAVLUNGO_DEFAULT_PACKAGE_TYPE`
- `NAVLUNGO_DEFAULT_PACKAGE_WEIGHT_KG`
- `NAVLUNGO_DEFAULT_PACKAGE_WIDTH_CM`
- `NAVLUNGO_DEFAULT_PACKAGE_LENGTH_CM`
- `NAVLUNGO_DEFAULT_PACKAGE_HEIGHT_CM`
- `NAVLUNGO_DEFAULT_DEST_COUNTRY`
- `NAVLUNGO_DEFAULT_DEST_CITY`
- `NAVLUNGO_DEFAULT_DEST_TOWN`
- `NAVLUNGO_DEFAULT_DEST_POSTAL_CODE`
- `NAVLUNGO_DEFAULT_DEST_STATE`
- `NAVLUNGO_DEFAULT_RECEIVER_PHONE`

## 11. Projede Ana Kod Noktaları
- `lib/navlungo/config.ts`
  - ortam, base URL ve credential çözümü
- `lib/navlungo/oauth.ts`
  - PKCE, state cookie, sign/verify
- `lib/navlungo/connection.ts`
  - ortak bağlantı kaydı
- `lib/navlungo/client.ts`
  - token exchange, refresh, API request client
- `lib/navlungo/shipment.ts`
  - order -> quote -> ship -> label orkestrasyonu
- `lib/stripe/checkout-payment-sync.ts`
  - ödeme sonrası Navlungo dispatch
- `app/api/orders/route.ts`
  - order create/read/delete
- `app/admin/page.tsx`
  - Navlungo bağlantı kartı

## 12. Hata Senaryoları
### `Navlungo shared account is not connected yet`
Sebep:
- Admin authorize akışı tamamlanmamıştır.
Çözüm:
- `/api/admin/navlungo/connect/start` ile bağlantıyı kur.

### `refresh_token` gelmedi
Sebep:
- Navlungo tarafında authorize akışı `offline_access` ile dönmemiş olabilir.
Çözüm:
- Navlungo uygulama tanımını ve token response’unu kontrol et.

### Quote oluşuyor ama shipment başlamıyor
Sebep:
- Quote var ama seçilebilir `quoteReference` yok.
Çözüm:
- `navlungo_response` içindeki quote içeriğini incele.

### Label URL boş kalıyor
Sebep:
- Shipment başladı ama label henüz oluşmadı.
Çözüm:
- `create label` + tekrar `get label` akışını ve `labelAttempts` response’unu kontrol et.

### Store create başarısız
Sebep:
- Sabit sender env alanları eksik veya format dışı olabilir.
Çözüm:
- Özellikle `NAVLUNGO_SENDER_IDENTIFICATION_NUMBER`, `NAVLUNGO_SENDER_ADDRESS1`, `NAVLUNGO_SENDER_TOWN` alanlarını kontrol et.

## 13. Resmi Kaynaklar
- `https://github.com/Navlungo/public-api-docs`
- `https://github.com/Navlungo/public-api-docs/blob/main/token.md`
- `https://github.com/Navlungo/public-api-docs/blob/main/quote.md`
- `https://github.com/Navlungo/public-api-docs/blob/main/store.md`
- `https://github.com/Navlungo/public-api-docs/blob/main/cargoTracking.md`
- `https://github.com/Navlungo/public-api-docs/blob/main/shipment.md`
