# V2 Cloud Run 发布前提

部署工作流是手动触发的 `.github/workflows/deploy-v2.yml`，只使用 `alsvid-prod` 项目、`alsvid-v2` 服务、`alsvid-v2` Artifact Registry 仓库和 `alsvid-v2-runtime` Secret Manager 密钥。它不会读取旧 `alsvid-production` 项目，也不会自动改 DNS。

项目管理员需要先授予：

- GitHub 仓库 `jinfenghua1990/ALSVID-V2` 对 `alsvid-github-deploy@alsvid-prod.iam.gserviceaccount.com` 的 Workload Identity User 权限；现有 provider 是 `projects/51910044792/locations/global/workloadIdentityPools/github/providers/alsvid-next`。
- `alsvid-runtime@alsvid-prod.iam.gserviceaccount.com` 读取 `alsvid-v2-runtime` 的 Secret Accessor 权限。
- `alsvid-github-deploy@alsvid-prod.iam.gserviceaccount.com` 的 Artifact Registry Writer 和 Cloud Run Admin 权限已核对存在。

授权后，在 GitHub Actions 手动运行「Deploy V2 to Cloud Run」。工作流先部署四个正式 HTTPS origin，再把 Cloud Run 临时 URL加入允许来源，完成健康、未登录边界和空目录验证。此时四个自定义域名仍未切换。

正式切换前必须逐项验证：

1. `www` 首页、目录与三种语言产品详情。
2. `admin` 内部账号与业务接口。
3. `my` 车主审核、车辆授权、服务申请和工单状态。
4. `dealer` 经销商授权、服务申请和数据隔离。
5. TLS、登录限流、回滚入口、DNS TTL 和旧入口仍可用。

全部验收通过后，才可迁移 DNS；再确认旧项目没有 V2 或其他业务依赖，最后删除旧云资源。
