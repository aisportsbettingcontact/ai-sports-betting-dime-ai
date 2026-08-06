ROOT<-Sys.getenv("ROOT"); LIB<-Sys.getenv("LIB"); CLEAN<-file.path(ROOT,"tmp","cleanlib")
# strip build-path attrs recursively THROUGH ATTRIBUTE VALUES as well as list elements
deep_strip2 <- function(x){
  a <- attributes(x)
  keep <- NULL
  if(!is.null(a)){
    keep <- a[setdiff(names(a), c("srcref","srcfile","Rdfile","wholeSrcref"))]
    if(length(keep)) keep <- lapply(keep, deep_strip2)   # <- recurse into attribute VALUES
  }
  if(is.list(x)){ y<-lapply(x,deep_strip2); attributes(y)<-keep; y }
  else { y<-x; attributes(y)<-keep; y }
}
tot<-0; totd<-0
for(p in c("nflverse","nflreadr","nflfastR","nflseedR","nfl4th","nflplotR")){
  ha<-new.env(); hb<-new.env()
  lazyLoad(file.path(LIB,p,"help",p),envir=ha); lazyLoad(file.path(CLEAN,p,"help",p),envir=hb)
  tp<-sort(ls(ha,all.names=TRUE)); d<-character(0)
  for(nm in tp){
    if(!identical(deep_strip2(get(nm,envir=ha)), deep_strip2(get(nm,envir=hb)))) d<-c(d,nm)
  }
  tot<-tot+length(tp); totd<-totd+length(d)
  cat(sprintf("%-10s topics=%-4d differing_after_full_deep_strip=%d %s\n",p,length(tp),length(d),
      if(length(d)) paste("->",paste(utils::head(d,6),collapse=", ")) else ""))
}
cat(sprintf("\nTOTAL: %d topics, %d differing after stripping ALL build-path attrs (incl. attribute values)\n",tot,totd))
