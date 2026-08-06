ROOT<-Sys.getenv("ROOT"); LIB<-Sys.getenv("LIB"); CLEAN<-file.path(ROOT,"tmp","cleanlib")
cat(sprintf("%-9s %-8s %-8s %-6s %-9s %-9s %-7s %s\n","pkg","first_l","first_n","delta","preflen_l","preflen_n","prefdlt","basenames_eq"))
res<-list()
for(p in c("nflverse","nflreadr","nflfastR","nflseedR","nfl4th","nflplotR")){
  a<-readRDS(file.path(LIB,p,"help","paths.rds")); b<-readRDS(file.path(CLEAN,p,"help","paths.rds"))
  fa<-attr(a,"first"); fb<-attr(b,"first")
  da<-unique(dirname(a)); db<-unique(dirname(b))
  pa<-sub("(.*/R[.]INSTALL[^/]*)/.*","\\1",da); pb<-sub("(.*/R[.]INSTALL[^/]*)/.*","\\1",db)
  sa<-sub(paste0("^",pa,"/"),"",a,fixed=FALSE); sb<-sub(paste0("^",pb,"/"),"",b,fixed=FALSE)
  sa<-substring(a,nchar(pa)+2); sb<-substring(b,nchar(pb)+2)
  cat(sprintf("%-9s %-8s %-8s %-6s %-9s %-9s %-7s %s\n",p,fa,fb,fb-fa,nchar(pa),nchar(pb),nchar(pb)-nchar(pa),
    identical(basename(a),basename(b))))
  cat(sprintf("   attrs live=[%s] new=[%s]; values identical after stripping staging prefix: %s\n",
    paste(names(attributes(a)),collapse=","),paste(names(attributes(b)),collapse=","),
    identical(unname(sa),unname(sb))))
  cat(sprintf("   R.INSTALL dir live=%s (%d chars)  new=%s (%d chars)\n",
    basename(pa),nchar(basename(pa)),basename(pb),nchar(basename(pb))))
  cat(sprintf("   attributes(a) identical attributes(b): %s ; equal after normalising 'first': %s\n",
    identical(attributes(a),attributes(b)),
    { A<-attributes(a); B<-attributes(b); A$first<-NULL; B$first<-NULL; identical(A,B) }))
}
