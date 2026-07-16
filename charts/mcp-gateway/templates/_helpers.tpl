{{/*
Chart-scoped aliases so `include "mcp-gateway.fullname"` etc. in this
chart's templates keep working. All actual logic lives in charts/common.
*/}}

{{- define "mcp-gateway.name" -}}{{ include "common.name" . }}{{- end -}}
{{- define "mcp-gateway.fullname" -}}{{ include "common.fullname" . }}{{- end -}}
{{- define "mcp-gateway.labels" -}}{{ include "common.labels" . }}{{- end -}}
{{- define "mcp-gateway.selectorLabels" -}}{{ include "common.selectorLabels" . }}{{- end -}}
{{- define "mcp-gateway.serviceAccountName" -}}{{ include "common.serviceAccountName" . }}{{- end -}}
