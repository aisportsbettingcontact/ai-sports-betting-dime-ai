ROOT<-Sys.getenv("ROOT")
raw<-read.csv(file.path(ROOT,"tmp","ws-b","raw90.csv"),stringsAsFactors=FALSE)
m2 <-read.csv(file.path(ROOT,"tmp","ws-b","dl.mirror2.csv"),stringsAsFactors=FALSE)
os <-read.csv(file.path(ROOT,"tmp","ws-b","dl.osuosl.csv"),stringsAsFactors=FALSE)
m2<-m2[match(raw$package,m2$package),]; os<-os[match(raw$package,os$package),]
out<-data.frame(
  package=raw$package, version=raw$version, channel=raw$channel,
  md5_actual=raw$md5_actual,
  md5_index_primary=raw$md5_index_primary,
  md5_index_mirror2=raw$md5_index_mirror2,
  sha256_primary=raw$sha256_recomputed,
  sha256_mirror2=m2$sha256,
  stringsAsFactors=FALSE)
# verdict: every available comparison must agree; missing evidence -> GAP
verdict<-character(nrow(out))
for(i in seq_len(nrow(out))){
  vals<-c(out$md5_actual[i],out$md5_index_primary[i],out$md5_index_mirror2[i])
  shas<-c(out$sha256_primary[i],out$sha256_mirror2[i])
  if(any(is.na(vals))||any(!nzchar(vals))||any(is.na(shas))||any(!nzchar(shas))) { verdict[i]<-"GAP"; next }
  ok_md5 <- length(unique(vals))==1
  ok_sha <- length(unique(shas))==1
  ok_ver <- identical(raw$version[i], raw$idx_ver_primary[i]) && identical(raw$version[i], raw$idx_ver_mirror2[i])
  ok_os  <- identical(out$sha256_primary[i], os$sha256[i])
  verdict[i]<- if(ok_md5 && ok_sha && ok_ver && ok_os) "PASS" else "FAIL"
}
out$verdict<-verdict
write.csv(out,file.path(ROOT,"evidence","ws-b","hash-verification.csv"),row.names=FALSE,quote=FALSE)
cat("rows:",nrow(out),"\n"); print(table(out$verdict))
cat("empty verdicts:",sum(!nzchar(out$verdict)),"\n")
cat("header:",paste(names(out),collapse=","),"\n")
