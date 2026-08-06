ROOT<-Sys.getenv("ROOT")
gh<-function(p) if(p=="nflverse") file.path(ROOT,"tmp","gh","nflverse_rel") else file.path(ROOT,"tmp","gh",p)
# fields CRAN's build/publish pipeline legitimately ADDS to a source tarball
cran_added <- c("Packaged","Date/Publication","Repository","NeedsCompilation","Author","Maintainer","Built")
# fields that are dev-only and legitimately DROPPED by R CMD build / roxygen tooling
dev_only  <- c("Roxygen","RoxygenNote","Remotes","Config/testthat/edition","Config/Needs/website","LazyDataCompression")
norm<-function(x) if(is.na(x)) NA_character_ else gsub("\\s+"," ",trimws(x))
for(p in c("nflverse","nflreadr","nflfastR","nflseedR","nfl4th","nflplotR")){
  a<-read.dcf(file.path(ROOT,"sources",p,"DESCRIPTION"))[1,]
  b<-read.dcf(file.path(gh(p),"DESCRIPTION"))[1,]
  only_a<-setdiff(names(a),names(b)); only_b<-setdiff(names(b),names(a))
  common<-intersect(names(a),names(b))
  vd<-common[vapply(common,function(f) !identical(norm(a[[f]]),norm(b[[f]])),logical(1))]
  cat(sprintf("\n===== %s =====\n",p))
  cat("  tarball-only fields:", paste(only_a,collapse=", "), "\n")
  cat("    all CRAN-publish-added?:", all(only_a %in% cran_added),
      if(length(setdiff(only_a,cran_added))) paste(" UNEXPECTED:",paste(setdiff(only_a,cran_added),collapse=",")) else "", "\n")
  cat("  github-only fields :", paste(only_b,collapse=", "), "\n")
  cat("    all dev-only?          :", all(only_b %in% dev_only),
      if(length(setdiff(only_b,dev_only))) paste(" UNEXPECTED:",paste(setdiff(only_b,dev_only),collapse=",")) else "", "\n")
  cat("  shared fields with DIFFERENT VALUE after whitespace-normalisation:",length(vd),"\n")
  for(f in vd){ cat("    *",f,"\n      tarball:",substr(norm(a[[f]]),1,160),"\n      github :",substr(norm(b[[f]]),1,160),"\n") }
  cat("  Version tarball/github :",a[["Version"]],"/",b[["Version"]],
      if(identical(a[["Version"]],b[["Version"]])) " MATCH" else " ***MISMATCH***","\n")
  cat("  Packaged               :", if("Packaged" %in% names(a)) a[["Packaged"]] else "-", "\n")
}
