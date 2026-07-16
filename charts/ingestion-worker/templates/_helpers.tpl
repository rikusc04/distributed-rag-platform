{{/*
Chart-scoped aliases so `include "ingestion-worker.fullname"` etc. in this
chart's templates keep working. All actual logic lives in charts/common.
*/}}

{{- define "ingestion-worker.name" -}}{{ include "common.name" . }}{{- end -}}
{{- define "ingestion-worker.fullname" -}}{{ include "common.fullname" . }}{{- end -}}
{{- define "ingestion-worker.labels" -}}{{ include "common.labels" . }}{{- end -}}
{{- define "ingestion-worker.selectorLabels" -}}{{ include "common.selectorLabels" . }}{{- end -}}
{{- define "ingestion-worker.serviceAccountName" -}}{{ include "common.serviceAccountName" . }}{{- end -}}
