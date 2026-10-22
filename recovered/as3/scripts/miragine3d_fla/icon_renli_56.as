package miragine3d_fla
{
   import flash.display.MovieClip;
   import flash.events.DataEvent;
   
   [Embed(source="/_assets/assets.swf", symbol="symbol202")]
   public dynamic class icon_renli_56 extends MovieClip
   {
      
      public function icon_renli_56()
      {
         super();
         addFrameScript(0,this.frame1);
      }
      
      internal function frame1() : *
      {
         dispatchEvent(new DataEvent("tips",true,false,"<font color=\'#ffffff\'>人力: 每个回合人力会补充到60,人力也是招兵消耗的资源之一.</font>"));
      }
   }
}

