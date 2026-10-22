package miragine3d_fla
{
   import flash.display.MovieClip;
   import flash.events.DataEvent;
   
   [Embed(source="/_assets/assets.swf", symbol="symbol186")]
   public dynamic class timebg_53 extends MovieClip
   {
      
      public function timebg_53()
      {
         super();
         addFrameScript(0,this.frame1);
      }
      
      internal function frame1() : *
      {
         dispatchEvent(new DataEvent("tips",true,false,"<font color=\'#ffffff\'>时间: 每30秒一个回合.</font>"));
      }
   }
}

