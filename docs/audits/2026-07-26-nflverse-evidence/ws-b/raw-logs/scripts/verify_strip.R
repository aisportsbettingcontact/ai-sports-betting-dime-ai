ROOT<-Sys.getenv("ROOT"); LIB<-Sys.getenv("LIB"); CLEAN<-file.path(ROOT,"tmp","cleanlib")
for(p in c("nflverse","nflreadr","nflfastR","nflseedR","nfl4th","nflplotR")){
  a<-readRDS(file.path(LIB,p,"help","paths.rds")); b<-readRDS(file.path(CLEAN,p,"help","paths.rds"))
  pa<-sub("(.*/R[.]INSTALL[^/]*)/.*","\\1",unique(dirname(a)))
  pb<-sub("(.*/R[.]INSTALL[^/]*)/.*","\\1",unique(dirname(b)))
  # strip prefix and DROP ALL ATTRIBUTES so only the string values are compared
  sa<-as.vector(substring(as.vector(a),nchar(pa)+2))
  sb<-as.vector(substring(as.vector(b),nchar(pb)+2))
  cat(sprintf("%-9s stripped values identical: %-5s  (n=%d)\n",p,identical(sa,sb),length(sa)))
  if(!identical(sa,sb)){
    d<-which(sa!=sb)
    cat("   first mismatch idx",d[1],": live='",sa[d[1]],"' new='",sb[d[1]],"'\n",sep="")
  } else cat("   e.g. '",sa[1],"'\n",sep="")
}
